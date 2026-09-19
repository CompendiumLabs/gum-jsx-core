import { align_offset, fit_scale, resolve_alignment } from '../lib/composition'
import type { Alignment, FitMode } from '../lib/composition'
import { make_fragment, place_fragment, transform_guides } from './fragment'
import type { Fragment } from './fragment'
import { make_point, make_rect, make_size, map_radii, read_point, transform_rect } from './geometry'
import { make_request, prepare_request, finish_size } from './layout'
import type { AxisSizing, LayoutRequest, Sizing } from './layout'

type FitSpec = Readonly<{ fit?: boolean | FitMode; fit_align?: Alignment }>

function fitting_mode(fit: FitSpec['fit']): FitMode | undefined {
  if (fit === undefined || fit === false) return undefined
  if (fit !== true && fit !== 'contain' && fit !== 'cover') {
    throw new TypeError('fit must be a boolean, "contain", or "cover"')
  }
  return fit
}

// Authored dimensions describe the natural drawing. Parent offers and own
// min/max constraints describe its final allocation. Fill is allocation policy,
// not an intrinsic dimension. Neither stage feeds back into the other.
function fitting_requests(request: LayoutRequest, sizing: Sizing) {
  const intrinsic_axis = (axis: AxisSizing): AxisSizing => ({
    preferred: axis.mode === 'fill' ? undefined : axis.preferred, min: 0, max: Infinity,
  })
  const target_axis = (axis: AxisSizing): AxisSizing => ({
    ...axis, preferred: axis.mode === 'fill' ? axis.preferred : undefined,
  })
  const intrinsic: Sizing = { width: intrinsic_axis(sizing.width), height: intrinsic_axis(sizing.height),
    aspect: sizing.aspect }
  const target: Sizing = { width: target_axis(sizing.width), height: target_axis(sizing.height) }
  return {
    intrinsic, natural: prepare_request(make_request(), intrinsic),
    target, request: prepare_request(request, target),
  }
}

// One transform keeps drawing, decoration, guides, and connection geometry in
// the same coordinate system. The source element itself never gets rebuilt.
function fit_fragment(source: Fragment, request: LayoutRequest, sizing: Sizing,
  mode: FitMode, align: Alignment = 'center'): Fragment {
  const alignment = resolve_alignment(align, 'fit_align')
  if (typeof alignment.x !== 'number' || typeof alignment.y !== 'number') {
    throw new TypeError('fit_align selects a position; fitting never stretches')
  }
  const target = {
    width: request.width.kind === 'natural' ? undefined : request.width.value,
    height: request.height.kind === 'natural' ? undefined : request.height.value,
  }
  const initial = fit_scale(source.size, target, mode)
  const size = finish_size(make_size(
    mode === true ? source.size.width * initial : target.width ?? source.size.width * initial,
    mode === true ? source.size.height * initial : target.height ?? source.size.height * initial,
  ), request, sizing)
  const scale = fit_scale(source.size, size, mode)
  const scaled = make_size(source.size.width * scale, source.size.height * scale)
  const offset = align_offset(size, scaled, alignment)
  if (scale === 1 && offset.x === 0 && offset.y === 0
    && size.width === source.size.width && size.height === source.size.height && mode !== 'cover') return source

  const transform = [scale, 0, 0, scale, 0, 0] as const
  const connection = source.connection && {
    id: source.connection.id,
    boundary: {
      ...transform_rect(source.connection.boundary, offset, transform)!,
      ...(source.connection.boundary.radius === undefined ? {} : {
        radius: map_radii(source.connection.boundary.radius, value => {
          const point = read_point(value)
          return make_point(point.x * scale, point.y * scale)
        }),
      }),
    },
  }
  return make_fragment({
    size, connection, connection_scope: source.connection_scope,
    children: [place_fragment(connection ? make_fragment({ ...source, connection: undefined }) : source,
      offset, transform)],
    guides: transform_guides(source.guides, offset.y, scale),
    ...(source.content ? { content: transform_rect(source.content, offset, transform)! } : {}),
    ...(source.math ? { math: { ...source.math,
      advance: source.math.advance * scale + size.width - scaled.width,
      italic: source.math.italic * scale, skew: source.math.skew * scale,
    } } : {}),
    ...(mode === 'cover' ? { clip: make_rect(0, 0, size.width, size.height) } : {}),
  })
}

export { fitting_mode, fitting_requests, fit_fragment }
export type { FitSpec }
