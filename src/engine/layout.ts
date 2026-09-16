import { nonnegative } from '../lib/checks'
import { DEFAULTS } from './defaults'
import { make_size } from './geometry'
import type { Insets, Size } from './geometry'
import { resolve_length } from './units'
import type { Length, LengthContext } from './units'

type Axis = 'width' | 'height'
type AxisRequest =
  | Readonly<{ kind: 'natural' }>
  | Readonly<{ kind: 'available' | 'exact'; value: number }>
type LayoutRequest = Readonly<Record<Axis, AxisRequest>>

type SizeKey = Axis | `min_${Axis}` | `max_${Axis}`
type SizeMode = 'fill' | 'fit'
type SizeSpec = Readonly<Partial<Record<Exclude<SizeKey, 'width'>, Length>>
  & { width?: Length | SizeMode; aspect?: number }>
type AxisSizing = Readonly<{ preferred?: number; mode?: SizeMode; min: number; max: number }>
type Sizing = Readonly<Record<Axis, AxisSizing> & { aspect?: number }>

const NATURAL = Object.freeze({ kind: 'natural' })

// Requests are in pixels. Natural is distinct from an infinite numeric offer.
function natural() {
  return NATURAL
}

// An advisory offer can be exceeded by content that cannot fit.
function available(value: number) {
  return Object.freeze({ kind: 'available', value: nonnegative(value, 'available') })
}

// A hard allocation fixes the reported dimension, allowing separate overflow.
function exact(value: number) {
  return Object.freeze({ kind: 'exact', value: nonnegative(value, 'exact') })
}

// Copy both axes to own their values, with natural requests for omitted axes.
function make_request(axes: Partial<LayoutRequest> = {}): LayoutRequest {
  function copy_axis(axis: AxisRequest = natural()): AxisRequest {
    if (axis.kind === 'natural') return natural()
    return axis.kind === 'exact' ? exact(axis.value) : available(axis.value)
  }
  return Object.freeze({
    width: copy_axis(axes.width),
    height: copy_axis(axes.height),
  })
}

// Deflate the offer without changing any percentage reference in the context.
function deflate_request(request: LayoutRequest, insets: Insets): LayoutRequest {
  function deflate_axis(axis: AxisRequest, amount: number): AxisRequest {
    if (axis.kind === 'natural') return axis
    const value = Math.max(0, axis.value - amount)
    return axis.kind === 'exact' ? exact(value) : available(value)
  }
  const { left, top, right, bottom } = insets
  return make_request({
    width: deflate_axis(request.width, left + right),
    height: deflate_axis(request.height, top + bottom),
  })
}

// Fractions use the established parent box. Fill instead selects the actual
// offered width, once, before own limits introduce any measurement budgets.
function resolve_sizing(spec: SizeSpec = {}, context: LengthContext & { request?: LayoutRequest } = {}): Sizing {
  const { font_size, reference = {}, path = 'root' } = context

  function resolve_axis(axis: Axis): AxisSizing {
    const basis = { font_size, fraction: reference[axis] }
    function resolve(key: SizeKey): number | undefined {
      const length = spec[key]
      if (length === undefined) return undefined
      const location = `${path}.${key}`
      if (typeof length === 'string') {
        throw new TypeError(`${location}: expected a length${key === 'width' ? ', "fill", or "fit"' : ''}`)
      }
      return nonnegative(resolve_length(length, basis, location), location)
    }

    const value = spec[axis]
    const mode = axis === 'width' && (value === 'fill' || value === 'fit') ? value : undefined
    const offer = context.request?.[axis]
    const preferred = mode === undefined ? resolve(axis)
      : mode === 'fill' && offer?.kind === 'available' ? nonnegative(offer.value, `${path}.${axis}`) : undefined
    const min = resolve(`min_${axis}`) ?? 0
    const max = resolve(`max_${axis}`) ?? Infinity
    if (min > max) {
      throw new RangeError(`${path}: min_${axis} exceeds max_${axis}`)
    }
    return Object.freeze({ preferred, ...(mode === undefined ? {} : { mode }), min, max })
  }

  const { aspect } = spec
  if (aspect !== undefined && nonnegative(aspect, `${path}.aspect`) === 0) {
    throw new RangeError(`${path}.aspect must be positive`)
  }
  return Object.freeze({
    width: resolve_axis('width'),
    height: resolve_axis('height'),
    aspect,
  })
}

// Clamp a preferred or measured dimension to the element's own limits.
function clamp_size(value: number, sizing: AxisSizing): number {
  return Math.max(sizing.min, Math.min(sizing.max, value))
}

// Parent allocations win; otherwise offer the child its resolved size policy.
// A preferred ratio derives an unresolved axis before layout, so every element
// sees the same definite allocation for reflow, fractions, and child alignment.
function prepare_request(request: LayoutRequest, sizing: Sizing): LayoutRequest {
  function prepare_axis(axis: AxisRequest, rule: AxisSizing): AxisRequest {
    if (axis.kind === 'exact') return axis
    if (rule.preferred !== undefined) return exact(clamp_size(rule.preferred, rule))
    if (axis.kind === 'available') return available(clamp_size(axis.value, rule))
    return rule.max < Infinity ? available(rule.max) : natural()
  }
  const width = prepare_axis(request.width, sizing.width)
  const height = prepare_axis(request.height, sizing.height)
  if (sizing.aspect !== undefined) {
    const w = width.kind === 'exact' ? width.value
      : sizing.width.min === sizing.width.max ? sizing.width.min : undefined
    const h = height.kind === 'exact' ? height.value
      : sizing.height.min === sizing.height.max ? sizing.height.min : undefined
    if (w !== undefined || h !== undefined) {
      return make_request({
        width: exact(w ?? clamp_size(h! * sizing.aspect, sizing.width)),
        height: exact(h ?? clamp_size(w! / sizing.aspect, sizing.height)),
      })
    }
  }
  return make_request({ width, height })
}

// Select the allocated box after measurement. An available budget is advisory.
function finish_size(content: Size, request: LayoutRequest, sizing: Sizing): Size {
  const prepared = prepare_request(request, sizing)
  function finish_axis(value: number, axis: AxisRequest, rule: AxisSizing): number {
    return axis.kind === 'exact' ? axis.value : clamp_size(value, rule)
  }
  let width = finish_axis(content.width, prepared.width, sizing.width)
  let height = finish_axis(content.height, prepared.height, sizing.height)
  if (sizing.aspect !== undefined && prepared.width.kind !== 'exact' && prepared.height.kind !== 'exact') {
    // Neither axis was established: grow the measured box to the requested
    // ratio, without shrinking/scaling content or turning offers into fill.
    const ratio_width = height * sizing.aspect
    // Repeated finishing must be stable despite division/multiplication rounding.
    const tolerance = Number.EPSILON * 8 * Math.max(width, Number.isFinite(ratio_width) ? ratio_width : 0)
    if (width < ratio_width - tolerance) width = clamp_size(ratio_width, sizing.width)
    else if (width > ratio_width + tolerance) height = clamp_size(width / sizing.aspect, sizing.height)
  }
  return make_size(width, height)
}

// Without an aspect, each axis fills its offer or uses the finite natural fallback.
// A preferred aspect couples the axes; exact dimensions take precedence over it.
function shape_size(request: LayoutRequest, sizing: Sizing = resolve_sizing()): Size {
  const prepared = prepare_request(request, sizing)
  const { width, height } = prepared
  const { aspect } = sizing
  let size: Size

  if (aspect === undefined) {
    size = make_size(
      width.kind === 'natural' ? DEFAULTS.shape_height : width.value,
      height.kind === 'natural' ? DEFAULTS.shape_height : height.value,
    )
  } else if (width.kind === 'exact' && height.kind === 'exact') {
    size = make_size(width.value, height.value)
  } else {
    const max_width = width.kind === 'available' ? width.value : Infinity
    const max_height = height.kind === 'available' ? height.value : Infinity
    const limit = Math.min(max_height, max_width / aspect)
    const shape_height = limit < Infinity ? limit : DEFAULTS.shape_height
    size = make_size(shape_height * aspect, shape_height)
  }

  // Own min/max limits may also override the preferred ratio.
  return finish_size(size, prepared, sizing)
}

export {
  natural, available, exact, make_request, deflate_request,
  resolve_sizing, prepare_request, finish_size, shape_size,
}
export type { Axis, AxisRequest, LayoutRequest, SizeMode, SizeSpec, AxisSizing, Sizing }
