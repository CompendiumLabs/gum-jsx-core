import { finite } from './checks'
import type { Element } from '../engine/element'
import { place_fragment, transform_guides } from '../engine/fragment'
import {
  make_size, make_point, make_rect, make_insets, deflate_size, inflate_size, bounds_overflow, read_point,
} from '../engine/geometry'
import type { Insets, Size } from '../engine/geometry'
import { available, exact, make_request, deflate_request, finish_size, resolve_sizing } from '../engine/layout'
import type { AxisRequest, AxisSizing, LayoutRequest, Sizing } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { resolve_font_size } from '../engine/units'
import type { ReferenceBox } from '../engine/units'

type AlignmentValue = number | 'start' | 'center' | 'end' | 'stretch' | 'fill'
type Alignment = AlignmentValue | Readonly<{ x?: AlignmentValue; y?: AlignmentValue }>
  | readonly [x: AlignmentValue, y: AlignmentValue]
type ResolvedAlignmentValue = number | 'stretch' | 'fill'
type ResolvedAlignment = Readonly<{ x: ResolvedAlignmentValue; y: ResolvedAlignmentValue }>
type FitMode = 'contain' | 'cover' | 'scale_down'

// Alignment values are dimensionless: 0/start, 0.5/center, and 1/end.
function resolve_alignment(align: Alignment = 'start', path = 'alignment'): ResolvedAlignment {
  const tuple = typeof align === 'object' && 'length' in align
  const axes = tuple ? read_point(align, path)
    : typeof align === 'object' ? align : { x: align, y: align }
  if (tuple && (axes.x === undefined || axes.y === undefined)) {
    throw new TypeError(`${path} needs two alignment values`)
  }
  function resolve(value: AlignmentValue = 'start'): ResolvedAlignmentValue {
    if (value === 'stretch' || value === 'fill') return value
    const fraction = typeof value === 'number' ? value
      : { start: 0, center: 0.5, end: 1 }[value]
    finite(fraction, path)
    if (fraction < 0 || fraction > 1) throw new RangeError(`${path} must be between 0 and 1`)
    return fraction
  }
  return Object.freeze({ x: resolve(axes.x), y: resolve(axes.y) })
}

// Oversized content can align outside the frame; keep the resulting negative offset.
function align_offset(size: Size, child: Size, align: ResolvedAlignment) {
  return make_point(
    (size.width - child.width) * (typeof align.x === 'number' ? align.x : 0),
    (size.height - child.height) * (typeof align.y === 'number' ? align.y : 0),
  )
}

// Fill chooses an allocation only for automatic sizes, within the child's
// limits. Stretch deliberately overrides both explicit sizes and limits.
function fills_axis(align: ResolvedAlignmentValue, sizing: AxisSizing): boolean {
  return align === 'stretch' || align === 'fill'
    && sizing.mode !== 'fit' && (sizing.preferred === undefined || sizing.mode === 'fill')
}

function aligned_request(offer: AxisRequest, size: number | undefined,
  align: ResolvedAlignmentValue, sizing?: AxisSizing): AxisRequest {
  if (size !== undefined) {
    if (align === 'stretch') return exact(size)
    if (sizing && fills_axis(align, sizing)) return exact(Math.max(sizing.min, Math.min(sizing.max, size)))
  }
  return offer.kind === 'exact' ? available(offer.value) : offer
}

// Exact allocations and equal min/max limits establish axes independently of a
// child. An ordinary available offer remains a budget for a hugging container.
function definite_reference(request: LayoutRequest, sizing: Sizing): ReferenceBox {
  const result: { width?: number; height?: number } = {}
  for (const axis of ['width', 'height'] as const) {
    const offer = request[axis], rule = sizing[axis]
    if (offer.kind === 'exact') result[axis] = offer.value
    else if (rule.min === rule.max) result[axis] = rule.min
  }
  return Object.freeze(result)
}

// One-child layout is deflate → query → inflate → align. The child's natural
// answer sets hugging axes, while definite axes provide percentage references.
// Fill/stretch send allocations only on axes established before measurement.
// No second query or element reconstruction is needed for ordinary alignment.
function layout_content(
  child: Element | undefined, query: LayoutQuery, insets: Insets = make_insets(),
  alignment: Alignment = 'start',
) {
  const align = resolve_alignment(alignment)
  const inner = deflate_request(query.request, insets)
  const fixed = definite_reference(query.request, query.sizing)
  const reference = Object.freeze({
    ...(fixed.width === undefined ? {} : {
      width: Math.max(0, fixed.width - insets.left - insets.right),
    }),
    ...(fixed.height === undefined ? {} : {
      height: Math.max(0, fixed.height - insets.top - insets.bottom),
    }),
  })
  let sizing: Sizing | undefined
  if (child && (align.x === 'fill' || align.y === 'fill')) {
    const path = `${query.path}/${child.type.name}[0]`
    const font_size = resolve_font_size(child.props.font_size, query.style.font_size, `${path}.font_size`)
    sizing = resolve_sizing(child.props, { font_size, reference, path })
  }
  const request = make_request({
    width: aligned_request(inner.width, reference.width, align.x, sizing?.width),
    height: aligned_request(inner.height, reference.height, align.y, sizing?.height),
  })
  const fragment = child ? query.child(child, request, reference) : undefined
  const measured = fragment?.size ?? make_size()
  const extent = inflate_size(measured, insets)
  const size = finish_size(extent, query.request, query.sizing)
  const area = deflate_size(size, insets)
  const content = make_rect(insets.left, insets.top, area.width, area.height)

  const shift = fragment ? align_offset(area, measured, align) : make_point()
  const offset = make_point(content.x + shift.x, content.y + shift.y)
  const placement = fragment ? place_fragment(fragment, offset) : undefined
  const guides = transform_guides(fragment?.guides ?? {}, offset.y)
  const bounds = make_rect(shift.x, shift.y, extent.width, extent.height)
  return { size, content, placement, guides, overflow: bounds_overflow(size, bounds) }
}

// Fit whole fragments uniformly. A zero source axis contributes no ratio; empty
// sources keep scale 1. An offered zero on a nonzero axis can produce scale 0.
function fit_scale(source: Size, target: ReferenceBox, mode: FitMode): number {
  if (!['contain', 'cover', 'scale_down'].includes(mode)) throw new TypeError('Unknown fit mode')
  const ratios = (['width', 'height'] as const).flatMap(axis => {
    const value = target[axis]
    return value === undefined || source[axis] === 0 ? [] : [value / source[axis]]
  })
  const scale = !ratios.length ? 1 : mode === 'cover' ? Math.max(...ratios) : Math.min(...ratios)
  return finite(mode === 'scale_down' ? Math.min(1, scale) : scale, 'fit scale')
}

export { resolve_alignment, align_offset, fills_axis, aligned_request, definite_reference, layout_content, fit_scale }
export type { AlignmentValue, Alignment, ResolvedAlignment, FitMode }
