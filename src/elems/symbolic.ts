import type { LayoutQuery } from '../engine/pass'
import type { ElementProps } from '../engine/element'
import { finite } from '../lib/checks'
import { Element, define_component } from '../engine/element'
import { make_fragment, place_fragment } from '../engine/fragment'
import { make_point } from '../engine/geometry'
import type { Point } from '../engine/geometry'
import { exact, make_request } from '../engine/layout'
import { CoordLine, Spline, Points, Fill, mark_context, mark_bounds, arrow_draw,
  head_scope, arrow_head_options, resolve_arrow_head } from './marks'
import type { CoordLineProps, SplineProps, PointsProps, FillProps, MarkProps, ArrowHeadScope } from './marks'
import { linspace, sample_points, sample_count, finite_point, scalar_value } from '../lib/sampling'
import type { PointValue, ScalarFunction, SampleProps } from '../lib/sampling'
import { px } from '../engine/units'
import type { Length } from '../engine/units'
import type { Limit } from '../engine/coordinates'

type SymLineProps = Omit<CoordLineProps, 'points'> & SampleProps
type SymSplineProps = Omit<SplineProps, 'points'> & SampleProps
type SymPointsProps = Omit<PointsProps, 'points'> & SampleProps
type SymFillProps = Omit<FillProps, 'points' | 'boundary'> & Readonly<{
  upper?: ScalarFunction; lower?: ScalarFunction; xlim?: Limit; xvals?: readonly number[]; samples?: number
  ylim?: Limit; yvals?: readonly number[]
}>
type VectorSample = Readonly<{ point: Point; vector: Point }>
type VectorSampleValue = Readonly<{ point: PointValue; vector: PointValue }>
type FieldProps = MarkProps & ArrowHeadScope & Readonly<{
  vectors?: readonly VectorSampleValue[]; scale?: number; normalize?: boolean
  shape?: Element | ((sample: VectorSample, index: number) => Element); shape_height?: Length
}>
type FieldDatum = Readonly<{ from: Point; to: Point; shape?: Element }>
type FieldData = Omit<FieldProps, 'vectors' | 'shape'> & Readonly<{ vectors: readonly FieldDatum[] }>
type SymFieldProps = Omit<FieldProps, 'vectors'> & Readonly<{
  f?: (x: number, y: number) => PointValue | null
  xlim?: Limit; ylim?: Limit; xvals?: readonly number[]; yvals?: readonly number[]
  samples?: number | Readonly<{ x: number; y: number }>
}>

function split_samples<T extends SampleProps>(props: T) {
  const { f, fx, fy, xlim, ylim, tlim, xvals, yvals, tvals, samples, ...style } = props
  return { style, points: sample_points({ f, fx, fy, xlim, ylim, tlim, xvals, yvals, tvals, samples }) }
}

const SymLine = define_component<SymLineProps>('SymLine', props => {
  const { style, points } = split_samples(props)
  return new CoordLine({ ...style, points })
})
const SymSpline = define_component<SymSplineProps>('SymSpline', props => {
  const { style, points } = split_samples(props)
  return new Spline({ ...style, points })
})
const SymPoly = define_component<SymLineProps>('SymPoly', props => {
  const { style, points } = split_samples(props)
  return new CoordLine({ ...style, points, closed: true })
})
const SymPoints = define_component<SymPointsProps>('SymPoints', props => {
  const { style, points } = split_samples(props)
  return new Points({ ...style, points })
})
const SymFill = define_component<SymFillProps>('SymFill', ({ upper = 1, lower = 0,
  xlim = [0, 1], xvals, ylim, yvals, samples = 101, ...props }) => {
  sample_count(samples)
  const horizontal = props.direction === 'horizontal', lim = horizontal ? ylim ?? xlim : xlim
  const values = (horizontal ? yvals : xvals) ?? linspace(lim[0], lim[1], samples)
  const point = (value: number, fn: ScalarFunction) => finite_point(horizontal
    ? { x: scalar_value(fn, value), y: value } : { x: value, y: scalar_value(fn, value) })
  const points = values.map(value => point(value, upper))
  const boundary = values.map(value => point(value, lower))
  return new Fill({ ...props, points, boundary })
})

// Vector directions are mapped before head construction, so non-square graph
// frames orient arrows correctly while head dimensions remain fixed in pixels.
class Field extends Element<FieldData, FieldProps> {
  static normalize({ vectors = [], scale = 1, normalize = false, shape, ...props }: FieldProps): FieldData {
    finite(scale, 'scale')
    return { ...head_scope(props), vectors: vectors.flatMap((sample, index) => {
      const from = finite_point(sample.point), vector = finite_point(sample.vector)
      if (!from || !vector) return []
      const norm = Math.hypot(vector.x, vector.y)
      if (!norm || !scale) return []
      const factor = scale / (normalize ? norm : 1)
      const to = finite_point({ x: from.x + vector.x * factor, y: from.y + vector.y * factor })
      if (!to) return []
      return [{ from, to, shape: typeof shape === 'function'
        ? shape(Object.freeze({ point: from, vector }), index) : shape }]
    }) }
  }
  static data_bounds(props: FieldData) {
    return mark_bounds(props, props.vectors.flatMap(vector => [vector.from, vector.to]))
  }
  static layout(props: FieldData, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query)
    const draw = [], children = []
    let head: ReturnType<typeof resolve_arrow_head> | undefined
    for (const [index, vector] of props.vectors.entries()) {
      const a = point(vector.from), b = point(vector.to)
      if (!a || !b) continue
      if (vector.shape) {
        const width = Math.hypot(b.x - a.x, b.y - a.y), height = length(props.shape_height ?? px(8))
        const fragment = query.child(vector.shape, make_request({ width: exact(width), height: exact(height) }),
          { width, height }, index, { coordinates: null })
        const angle = Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(angle), s = Math.sin(angle)
        children.push(place_fragment(fragment, a, [c, s, -s, c, s * height / 2, -c * height / 2]))
      } else {
        head ??= resolve_arrow_head({ ...arrow_head_options(props), head_size: props.head_size ?? px(5) },
          size, query.style, query.measure, paint)
        draw.push(...arrow_draw([a, b], paint, head, {}))
      }
    }
    return make_fragment({ size, draw, children })
  }
}

const SymField = define_component<SymFieldProps>('SymField', ({ f, xlim = [-1, 1], ylim = [-1, 1],
  xvals, yvals, samples = 11, ...props }) => {
  const counts = typeof samples === 'number' ? { x: samples, y: samples } : samples
  sample_count(counts.x, 1000); sample_count(counts.y, 1000)
  const xs = xvals ?? linspace(xlim[0], xlim[1], counts.x)
  const ys = yvals ?? linspace(ylim[0], ylim[1], counts.y)
  sample_count(xs.length * ys.length, 100000)
  if (!f) return new Field({ ...props, vectors: [] })
  const vectors: VectorSample[] = []
  for (const x of xs) for (const y of ys) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const vector = finite_point(f(x, y))
    if (vector) vectors.push({ point: make_point(x, y), vector })
  }
  return new Field({ ...props, vectors })
})

export { SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField }
export type { SymLineProps, SymSplineProps, SymPointsProps, SymFillProps,
  VectorSample, VectorSampleValue, FieldProps, SymFieldProps }
