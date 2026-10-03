import { finite, nonnegative } from '../lib/checks'
import { coordinate_point, position_bounds } from '../engine/coordinates'
import type { GeometrySpace } from '../engine/coordinates'
import { finite_position, read_cartesian } from '../engine/coordinate'
import type { CoordinatePosition } from '../engine/coordinate'
import { arc_path, rounded_path, spline_path } from '../lib/curves'
import { arrow_barb } from '../lib/arrows'
import { draw_path } from '../engine/drawing'
import type { Paint } from '../engine/drawing'
import { Element, define_component, content_child, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment } from '../engine/fragment'
import { make_point, read_point } from '../engine/geometry'
import type { Point, Size } from '../engine/geometry'
import { exact, make_request, shape_size } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import type { PathCommand } from '../engine/path'
import { transform_path } from '../engine/path'
import { prefix_split, scope_props } from '../lib/props'
import type { Prefixed } from '../lib/props'
import { Circle, is_position } from './shapes'
import type { PositionValue, Radius } from './shapes'
import { Rotate, TransformBox } from './placement'
import { resolve_paint, resolve_style } from '../engine/style'
import type { Style, StyleSpec } from '../engine/style'
import { make_measure, px, resolve_length } from '../engine/units'
import type { Length, LengthContext } from '../engine/units'

type MarkProps = ElementProps & Readonly<{ space?: GeometrySpace }>
type PolylineProps = MarkProps & Readonly<{ points?: readonly (CoordinatePosition | null)[]; closed?: boolean }>
type LineProps = MarkProps & Readonly<{ from?: CoordinatePosition; to?: CoordinatePosition }>
type AxisLineProps = Omit<LineProps, 'from' | 'to'> & Readonly<{ lim?: readonly [Length, Length] }>
type HLineProps = AxisLineProps & Readonly<{ y?: Length }>
type VLineProps = AxisLineProps & Readonly<{ x?: Length }>
type PolygonProps = Omit<PolylineProps, 'closed'>
type SplineProps = PolylineProps & Readonly<{ tension?: number }>
type RoundedLineProps = PolylineProps & Readonly<{ radius?: Length }>
type SegmentsProps = MarkProps & Readonly<{ segments?: readonly (readonly [CoordinatePosition, CoordinatePosition])[] }>
type ArcProps = MarkProps & Readonly<{ center?: CoordinatePosition; radius?: Radius; start?: number; end?: number }>
type FillProps = MarkProps & Readonly<{
  points?: readonly (CoordinatePosition | null)[]
  boundary?: readonly (CoordinatePosition | null)[] | number
  direction?: 'vertical' | 'horizontal'
}>
type ArrowBarbSide = 'both' | 'left' | 'right'
type ArrowHeadOptions = StyleSpec & Readonly<{
  head_size?: Length; head_width?: number; open?: boolean; curve?: number; barb?: ArrowBarbSide
}>
type ArrowHeadStyle = Omit<ArrowHeadOptions, 'head_size' | 'head_width'>
type ArrowHeadScope = Pick<ArrowHeadOptions, 'head_size' | 'head_width'>
  & Prefixed<'head', ArrowHeadStyle> & Readonly<{ head_style?: ArrowHeadStyle }>
type ArrowProps = MarkProps & ArrowHeadScope & Readonly<{
  from?: CoordinatePosition; to?: CoordinatePosition; points?: readonly (CoordinatePosition | null)[]
  start_head?: boolean; end_head?: boolean; curve?: boolean; tension?: number; radius?: Length
}>
type ArrowHeadProps = MarkProps & ArrowHeadOptions & Readonly<{
  tip?: CoordinatePosition; angle?: number
}>
type RayProps = MarkProps & Readonly<{ origin?: CoordinatePosition; angle?: number; length?: Length }>
type PointSize = Length | PositionValue
type MarkerPoint<P extends CoordinatePosition> = P extends readonly [Length, Length]
  ? Readonly<{ x: P[0]; y: P[1] }> : Readonly<P>
type PointsProps<P extends CoordinatePosition = CoordinatePosition> = MarkProps & Readonly<{
  points?: readonly (P | null)[]
  point_size?: PointSize | ((point: NoInfer<MarkerPoint<P>>, index: number) => PointSize)
  shape?: Element | ((point: NoInfer<MarkerPoint<P>>, index: number) => Element)
}>
type Marker = Readonly<{ point: MarkerPoint<CoordinatePosition>; size: PointSize; shape: Element }>
type PointsData = MarkProps & Readonly<{ markers: readonly Marker[] }>

const MARKER_TRANSFORMS = new Set([new Rotate().type.layout, new TransformBox().type.layout])
const SIZED_MARKERS = new WeakMap<Element, Map<string, Element>>()

// Point dimensions belong to the marker drawing, including when a transparent
// transform wrapper naturally measures its child. Rebuild only the immutable
// marker description; layout state and resolved geometry remain in LayoutPass.
function sized_marker(shape: Element, width: number, height: number): Element {
  const variants = SIZED_MARKERS.get(shape) ?? new Map<string, Element>()
  SIZED_MARKERS.set(shape, variants)
  const key = `${width},${height}`
  const cached = variants.get(key)
  if (cached) return cached
  const child = MARKER_TRANSFORMS.has(shape.type.layout) ? content_child(shape.props.children) : undefined
  const sized = new Element(shape.type, {
    ...shape.props,
    width: px(width),
    height: px(height),
    ...(child ? { children: sized_marker(child, width, height) } : {}),
  })
  variants.set(key, sized)
  return sized
}

// Marks use ambient data coordinates; space="local" opts out. Without a
// coordinate context they use ordinary fractional/px/em geometry.
function mark_context(props: MarkProps, query: LayoutQuery) {
  if (element_children(props.children).length) throw new TypeError('Marks have no content children')
  if (props.space && !['local', 'data'].includes(props.space)) throw new TypeError('Unknown geometry space')
  if (props.space === 'data' && !query.coordinates) throw new TypeError('Data geometry needs a coordinate context such as Graph or Plot')
  const size = shape_size(query.request, query.sizing)
  const coord = props.space === 'local' ? undefined : query.coordinates
  const point = (value: CoordinatePosition | null) => {
    const source = finite_position(value)
    return source && coordinate_point(source, size, query.measure, coord)
  }
  const length = (value: Length) => nonnegative(resolve_length(value,
    query.measure, Math.min(size.width, size.height), 'length'), 'length')
  return { size, point, length, coord, paint: resolve_paint(query.style, size, query.measure) }
}

function mark_bounds(props: MarkProps, points: readonly (CoordinatePosition | null)[]) {
  return props.space === 'local' ? null : position_bounds(points)
}

// Source gaps and null projection results break paths instead of joining holes.
function split_runs<T>(points: readonly (T | null)[]): T[][] {
  const runs: T[][] = []
  let run: T[] = []
  for (const point of points) {
    if (point !== null) run.push(point)
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run)
  return runs
}

function projected_runs(points: readonly (CoordinatePosition | null)[], project: (point: CoordinatePosition | null) => Point | null): Point[][] {
  return split_runs(points.map(project))
}

function line_path(points: readonly Point[], closed = false): PathCommand[] {
  const path: PathCommand[] = points.map((p, i) => ({ kind: i ? 'L' : 'M', ...p }))
  if (closed && points.length > 1) path.push({ kind: 'Z' })
  return path
}

class Line extends Element<LineProps> {
  static data_bounds(props: LineProps) {
    return mark_bounds(props, [props.from ?? [0, 0], props.to ?? [1, 1]])
  }
  static layout(props: LineProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query)
    const from = point(props.from ?? [0, 0])
    const to = point(props.to ?? [1, 1])
    const commands: PathCommand[] = from && to ? [{ kind: 'M', ...from }, { kind: 'L', ...to }] : []
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] })
  }
}

class Polyline extends Element<PolylineProps> {
  static data_bounds(props: PolylineProps) {
    return mark_bounds(props, props.points ?? [])
  }
  static layout(props: PolylineProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query)
    const commands = projected_runs(props.points ?? [], point).flatMap(run => line_path(run, props.closed))
    return make_fragment({ size, draw: [draw_path(commands, paint)] })
  }
}

// A polygon shares Polyline's coordinate mapping and closes every finite run.
const Polygon = define_component<PolygonProps>('Polygon', props => new Polyline({ ...props, closed: true }))

// Unit conveniences retain local geometry unless a space is explicitly supplied.
const UnitLine = define_component<LineProps>('UnitLine', ({ space = 'local', ...props }) => new Line({
  from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, ...props, space,
}))

// Directional lines share Line's sizing and coordinate mapping, with one fixed axis.
function axis_line({ lim = [0, 1], ...props }: AxisLineProps, axis: 'x' | 'y', position: Length) {
  const name = axis === 'y' ? 'HLine' : 'VLine'
  if ('from' in props || 'to' in props) {
    throw new TypeError(`${name} uses ${axis} and lim; use Line for from/to endpoints`)
  }
  if (!Array.isArray(lim) || lim.length !== 2 || !Object.hasOwn(lim, 0) || !Object.hasOwn(lim, 1)) {
    throw new TypeError(`${name}.lim needs two endpoints`)
  }
  const point = (value: Length) => axis === 'y' ? { x: value, y: position } : { x: position, y: value }
  return new Line({ ...props, from: point(lim[0]), to: point(lim[1]) })
}

const HLine = define_component<HLineProps>('HLine', ({ y = 0.5, ...props }) => axis_line(props, 'y', y))
const VLine = define_component<VLineProps>('VLine', ({ x = 0.5, ...props }) => axis_line(props, 'x', x))
const Triangle = define_component<PolygonProps>('Triangle', ({ space = 'local', ...props }) => new Polygon({
  points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], ...props, space,
}))

class Spline extends Element<SplineProps> {
  static data_bounds(props: SplineProps) {
    return mark_bounds(props, props.points ?? [])
  }
  static layout(props: SplineProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query)
    const commands = projected_runs(props.points ?? [], point).flatMap(run =>
      spline_path(run, props.tension, props.closed))
    return make_fragment({ size, draw: [draw_path(commands, paint)] })
  }
}

class RoundedLine extends Element<RoundedLineProps> {
  static data_bounds(props: RoundedLineProps) {
    return mark_bounds(props, props.points ?? [])
  }
  static layout(props: RoundedLineProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query)
    const commands = projected_runs(props.points ?? [], point).flatMap(run =>
      rounded_path(run, length(props.radius ?? px(8))))
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] })
  }
}

class Segments extends Element<SegmentsProps> {
  static data_bounds(props: SegmentsProps) {
    return mark_bounds(props, (props.segments ?? []).flat())
  }
  static layout(props: SegmentsProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query)
    const commands = (props.segments ?? []).flatMap(segment => {
      if (segment.length !== 2) throw new TypeError('Each segment needs two endpoints')
      const [a, b] = segment.map(point)
      return a && b ? line_path([a, b]) : []
    })
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] })
  }
}

class Arc extends Element<ArcProps> {
  static data_bounds(props: ArcProps) {
    if (props.space === 'local') return null
    const r = props.radius ?? 0.5
    const pair = is_position(r) ? read_point(r, 'radius') : { x: r, y: r }
    if (typeof pair.x !== 'number' || typeof pair.y !== 'number') return null
    const c = read_cartesian<Length>(props.center ?? { x: 0.5, y: 0.5 }, 'Arc source bounds')
    return typeof c.x === 'number' && typeof c.y === 'number'
      && typeof pair.x === 'number' && typeof pair.y === 'number' ? mark_bounds(props, [
        { x: c.x - pair.x, y: c.y - pair.y }, { x: c.x + pair.x, y: c.y + pair.y },
      ]) : null
  }
  static layout(props: ArcProps, query: LayoutQuery) {
    const { size, point, paint, length, coord } = mark_context(props, query)
    const center = props.center ?? { x: 0.5, y: 0.5 }, radius = props.radius ?? 0.5
    const paired = is_position(radius)
    const pair = paired ? read_point(radius, 'radius') : { x: radius, y: radius }
    const origin = point(center)
    if (!origin) return make_fragment({ size })
    function delta(value: Length, axis: 'x' | 'y'): number {
      if (coord && typeof value === 'number') {
        if (coord.projection) throw new TypeError('Projected Arc radii need local lengths; use sampled Polyline points for a data-space arc')
        nonnegative(value, 'radius')
        const lim = axis === 'x' ? coord.xlim : coord.ylim
        return value / (lim[1] - lim[0]) * (axis === 'x' ? size.width : size.height)
          * ((axis === 'x' ? coord.flip_x : coord.flip_y) ? -1 : 1)
      }
      return paired
        ? nonnegative(resolve_length(value, query.measure, axis === 'x' ? size.width : size.height, 'radius'), 'radius') : length(value)
    }
    const commands = arc_path(origin, make_point(delta(pair.x, 'x'), delta(pair.y, 'y')), props.start, props.end)
    return make_fragment({ size, draw: [draw_path(commands, paint)] })
  }
}

// Both boundaries share indices. A gap in either splits the entire filled region.
function fill_pairs(props: FillProps): readonly (readonly [CoordinatePosition, CoordinatePosition] | null)[] {
  const { points = [], boundary = 0, direction = 'vertical' } = props
  if (!['vertical', 'horizontal'].includes(direction)) throw new TypeError('Unknown fill direction')
  if (typeof boundary !== 'number' && boundary.length !== points.length) {
    throw new RangeError('Fill boundaries need matching lengths')
  }
  return points.map((value, i) => {
    const source = typeof boundary === 'number' && value !== null
      ? read_cartesian<Length>(value, `Fill points[${i}] with a scalar boundary`) : value
    const point = finite_position(source, `points[${i}]`)
    const other = typeof boundary === 'number'
      ? point && (direction === 'vertical' ? { x: point.x, y: boundary } : { x: boundary, y: point.y })
      : boundary[i]
    const paired = finite_position(other, `boundary[${i}]`)
    return point && paired ? [point, paired] as const : null
  })
}

function fill_layout(props: FillProps, query: LayoutQuery) {
  const { size, point, paint } = mark_context(props, query)
  const commands: PathCommand[] = [], pairs = fill_pairs(props)
  let run: (readonly [Point, Point])[] = []
  function flush() {
    if (run.length > 1) {
      const path = line_path([
        ...run.map(pair => pair[0]), ...run.toReversed().map(pair => pair[1]),
      ], true)
      for (const command of path) commands.push(command)
    }
    run = []
  }
  for (const pair of pairs) {
    const a = pair && point(pair[0]), b = pair && point(pair[1])
    if (a && b) run.push([a, b]); else flush()
  }
  flush()
  return make_fragment({ size, draw: [draw_path(commands, paint)] })
}

class Fill extends Element<FillProps> {
  static defaults: Partial<FillProps> = { fill: 'theme:area', stroke: 'none' }
  static data_bounds(props: FillProps) {
    return mark_bounds(props,
      fill_pairs(props).flatMap(pair => pair ? [...pair] : []))
  }
  static layout = fill_layout
}

class VFill extends Fill {
  static defaults: Partial<FillProps> = { direction: 'vertical' }
}

class HFill extends Fill {
  static defaults: Partial<FillProps> = { direction: 'horizontal' }
}

function arrow_head(tip: Point, angle: number, barb: ReturnType<typeof arrow_barb>, open: boolean,
  side: ArrowBarbSide): PathCommand[] {
  const c = Math.cos(angle), s = Math.sin(angle)
  const upper = transform_path(barb.commands, [-c, -s, s, -c, tip.x, tip.y])
  const lower = transform_path(barb.commands, [-c, -s, -s, c, tip.x, tip.y])
  const path: PathCommand[] = []
  for (let i = side === 'right' ? 0 : upper.length - 1; i > 0; i--) {
    const a = upper[i], b = upper[i - 1]
    if (a.kind === 'Z' || b.kind === 'Z') continue
    if (!path.length) path.push({ kind: 'M', x: a.x, y: a.y })
    path.push(a.kind === 'C'
      ? { kind: 'C', x1: a.x2, y1: a.y2, x2: a.x1, y2: a.y1, x: b.x, y: b.y }
      : { kind: 'L', x: b.x, y: b.y })
  }
  if (!path.length) path.push({ kind: 'M', ...tip })
  if (side !== 'left') path.push(...lower.slice(1))
  if (!open) {
    if (side !== 'both') {
      const length = barb.at(1).x
      path.push({ kind: 'L', x: tip.x - length * c, y: tip.y - length * s })
    }
    path.push({ kind: 'Z' })
  }
  return path
}

function arrow_points(props: ArrowProps): readonly (CoordinatePosition | null)[] {
  return props.points ?? [props.from ?? { x: 0, y: 0 }, props.to ?? { x: 1, y: 1 }]
}

// Size and width already carry the head prefix on standalone ArrowHead. Every
// other shape or style option is scoped automatically, without a geometry list.
function head_scope<Props extends ArrowHeadScope>(props: Props): Props {
  return scope_props(props, ['head'], ['head_size', 'head_width'])
}

function arrow_head_options(props: ArrowHeadScope): ArrowHeadOptions {
  const [flat] = prefix_split(['head'], props, ['head_size', 'head_width', 'head_style'])
  // Flat class defaults are applied after construction-time normalization.
  // Explicit options already in head_style take precedence over those defaults.
  return { ...flat, ...props.head_style, head_size: props.head_size, head_width: props.head_width }
}

// Both the element and generated arrowheads use this resolver and drawing path.
// An attached head inherits its shaft's stroke; an open head always has no fill.
function resolve_arrow_head(props: ArrowHeadOptions, size: Size, inherited: Style, context: LengthContext, shaft?: Paint) {
  const style = shaft ? resolve_style({ fill: shaft.stroke,
    stroke: props.open ? shaft.stroke : 'none', ...props }, inherited, context) : inherited
  const measure = make_measure(context, { font_size: style.font_size })
  const length = nonnegative(resolve_length(props.head_size ?? px(9), measure,
    Math.min(size.width, size.height), 'head_size'), 'head_size')
  const width = props.head_width ?? (shaft ? 1.3 : 0.65), curve = props.curve ?? 0, open = props.open ?? false
  const side = props.barb ?? 'both'
  if (!['both', 'left', 'right'].includes(side)) throw new TypeError('barb must be both, left, or right')
  const barb = arrow_barb(length, width, curve), paint = resolve_paint(style, size, measure)
  return { length, width, curve, open, barb, side,
    draw: (tip: Point, angle: number) => draw_path(arrow_head(tip, angle, barb, open, side),
      open ? { ...paint, fill: 'none' } : paint) }
}

// A head narrows to zero at the tip. Retreat far enough that the
// shaft's cap fits between its sides, using the resolved stroke width in pixels.
function arrow_inset(paint: Paint, head: ReturnType<typeof resolve_arrow_head>): number {
  const { length, width, curve, barb } = head
  const half = paint.stroke === 'none' ? 0 : paint.stroke_width / 2
  if (!half) return 0
  const corner = 2 * half / width
  const cap = paint.stroke_linecap ?? 'butt'
  // A curved head uses the cap's enclosing rectangle; the straight case keeps
  // its exact round-cap clearance. Both follow the actual drawn barb geometry.
  const inset = curve ? barb.reach(half) + (cap === 'butt' ? 0 : half)
    : cap === 'round' ? Math.hypot(half, corner) : corner + (cap === 'square' ? half : 0)
  // A head narrower than the shaft cannot cover it. Let the cap reach the head's
  // base instead of leaving a gap by retreating farther than the whole head.
  return Math.min(inset, length + (cap === 'butt' ? 0 : half))
}

// Own the shortened route before generating a straight, rounded, or spline
// shaft. Consume short terminal segments instead of moving endpoints backwards.
function inset_route(points: readonly Point[], start: number, end: number): readonly Point[] {
  function cut(route: readonly Point[], distance: number): readonly Point[] {
    if (!distance) return route
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i]
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      if (distance < length) {
        const t = distance / length
        return [make_point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), ...route.slice(i)]
      }
      distance -= length
    }
    return []
  }
  const route = cut(points, start)
  return end ? cut(route.toReversed(), end).toReversed() : route
}

function arrow_draw(points: readonly Point[], paint: Paint, head: ReturnType<typeof resolve_arrow_head>,
  props: Pick<ArrowProps, 'start_head' | 'end_head' | 'curve' | 'tension'>,
  radius = 0, directions?: Readonly<{ start: Point; end: Point }>) {
  const distinct = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
  const headed = distinct.length > 1 && head.length > 0
  const start = headed && (props.start_head ?? false), end = headed && (props.end_head ?? true)
  // Open or one-sided heads meet the shaft at the tip. A full filled head
  // covers a shortened shaft; a half head cannot cover both sides of its cap.
  const inset = (start || end) && !head.open && head.side === 'both' ? arrow_inset(paint, head) : 0
  let shaft = start || end ? inset_route(distinct, start ? inset : 0, end ? inset : 0) : points
  // Network supplies unit tangents in final pixels. Retreat beneath its heads
  // along those tangents, which need not follow the chord between the nodes.
  if (directions && props.curve && headed && shaft.length > 1) {
    const a = distinct[0], b = distinct.at(-1)!
    const ds = start ? inset : 0, de = end ? inset : 0
    shaft = [make_point(a.x + directions.start.x * ds, a.y + directions.start.y * ds),
      ...distinct.slice(1, -1), make_point(b.x - directions.end.x * de, b.y - directions.end.y * de)]
  }
  const path = props.curve ? spline_path(shaft, props.tension)
    : radius ? rounded_path(shaft, radius) : line_path(shaft)
  if (directions && props.curve && shaft.length > 1) {
    const a = shaft[0], b = shaft[1], c = shaft.at(-2)!, d = shaft.at(-1)!
    const first = path[1], last = path.at(-1)!
    const scale = (props.tension ?? 1) / 3
    const ds = Math.hypot(b.x - a.x, b.y - a.y) * scale
    const de = Math.hypot(d.x - c.x, d.y - c.y) * scale
    if (first.kind === 'C') path[1] = { ...first,
      x1: a.x + directions.start.x * ds, y1: a.y + directions.start.y * ds }
    // Read again: a two-node route has just one cubic with both endpoint handles.
    if (last.kind === 'C') path[path.length - 1] = { ...path.at(-1)! as typeof last,
      x2: d.x - directions.end.x * de, y2: d.y - directions.end.y * de }
  }
  const draw = [draw_path(path, { ...paint, fill: 'none' })]
  if (!headed) return draw
  const add = (tip: Point, before: Point, direction?: Point) => draw.push(
    head.draw(tip, Math.atan2(direction?.y ?? tip.y - before.y, direction?.x ?? tip.x - before.x)))
  if (start) add(distinct[0], distinct[1], directions && make_point(-directions.start.x, -directions.start.y))
  if (end) add(distinct[distinct.length - 1], distinct[distinct.length - 2], directions?.end)
  return draw
}

class Arrow extends Element<ArrowProps> {
  static normalize(props: ArrowProps): ArrowProps {
    return head_scope(props)
  }
  static data_bounds(props: ArrowProps) {
    return mark_bounds(props, arrow_points(props))
  }
  static layout(props: ArrowProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query)
    const head = resolve_arrow_head(arrow_head_options(props), size, query.style, query.measure, paint)
    const points = arrow_points(props).map(point)
    const draw = (points.length ? split_runs(points) : [[]]).flatMap(run => arrow_draw(run, paint, head, {
      ...props,
      start_head: Boolean(props.start_head && run[0] === points[0]),
      end_head: (props.end_head ?? true) && run.at(-1) === points.at(-1),
    }, length(props.radius ?? 0)))
    return make_fragment({ size, draw })
  }
}

class ArrowHead extends Element<ArrowHeadProps> {
  static defaults: Partial<ArrowHeadProps> = { fill: 'theme:foreground' }
  static data_bounds(props: ArrowHeadProps) {
    return mark_bounds(props, [props.tip ?? { x: 1, y: 0.5 }])
  }
  static layout(props: ArrowHeadProps, query: LayoutQuery) {
    const { size, point } = mark_context(props, query)
    const head = resolve_arrow_head(props, size, query.style, query.measure)
    const tip = point(props.tip ?? { x: 1, y: 0.5 })
    if (!tip) return make_fragment({ size })
    return make_fragment({ size, draw: [head.draw(tip,
      finite(props.angle ?? 0, 'angle') * Math.PI / 180)] })
  }
}

class Ray extends Element<RayProps> {
  static data_bounds(props: RayProps) {
    return mark_bounds(props, [props.origin ?? { x: 0.5, y: 0.5 }])
  }
  static layout(props: RayProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query)
    const origin = point(props.origin ?? { x: 0.5, y: 0.5 })
    if (!origin) return make_fragment({ size })
    const angle = finite(props.angle ?? 0, 'angle') * Math.PI / 180, distance = length(props.length ?? 0.5)
    const end = make_point(origin.x + distance * Math.cos(angle), origin.y + distance * Math.sin(angle))
    return make_fragment({ size, draw: [draw_path(line_path([origin, end]), { ...paint, fill: 'none' })] })
  }
}

class Points<P extends CoordinatePosition = CoordinatePosition> extends Element<PointsData, PointsProps<P>> {
  static normalize<P extends CoordinatePosition>({ points = [], point_size = px(6), shape, children, ...props }: PointsProps<P>): PointsData {
    const child = content_child(children)
    if (child && shape !== undefined) throw new TypeError('Points accepts either a child marker or shape, not both')
    shape ??= child
    if (shape === undefined) {
      props = { fill: 'theme:foreground', stroke: 'none', ...props }
      shape = new Circle()
    }
    return { ...props,
      markers: points.flatMap((value, index) => {
        const point = finite_position(value, `points[${index}]`) as MarkerPoint<P> | null
        return point ? [{ point,
          size: typeof point_size === 'function' ? point_size(point, index) : point_size,
          shape: typeof shape === 'function' ? shape(point, index) : shape }] : []
      }),
    }
  }
  static data_bounds(props: PointsData) {
    return mark_bounds(props, props.markers.map(marker => marker.point))
  }
  static layout(props: PointsData, query: LayoutQuery) {
    const { size, point } = mark_context(props, query)
    const children = props.markers.flatMap((marker, index) => {
      const center = point(marker.point)
      if (!center) return []
      const paired = is_position(marker.size)
      const pair = paired
        ? read_point(marker.size, 'point_size') : { x: marker.size, y: marker.size }
      const dimension = (value: Length, fraction: number) => nonnegative(resolve_length(value,
        query.measure, fraction, 'point_size'), 'point_size')
      const width = dimension(pair.x, paired ? size.width : Math.min(size.width, size.height))
      const height = dimension(pair.y, paired ? size.height : Math.min(size.width, size.height))
      const fragment = query.child(sized_marker(marker.shape, width, height),
        make_request({ width: exact(width), height: exact(height) }),
        { width, height }, index, { coordinates: null })
      return [place_fragment(fragment, make_point(center.x - width / 2, center.y - height / 2))]
    })
    return make_fragment({ size, children })
  }
}

export { Line, HLine, VLine, UnitLine, Polygon, Triangle, Polyline, Spline, RoundedLine,
  Segments, Arc, Fill, HFill, VFill, Arrow, ArrowHead, Ray, Points, mark_context, mark_bounds, line_path, arrow_draw,
  head_scope, arrow_head_options, resolve_arrow_head }
export type { LineProps, HLineProps, VLineProps, PolygonProps, MarkProps, PolylineProps,
  SplineProps, RoundedLineProps, SegmentsProps, ArcProps, FillProps, ArrowProps, ArrowBarbSide,
  ArrowHeadOptions, ArrowHeadStyle, ArrowHeadScope, ArrowHeadProps, RayProps, PointSize, PointsProps }
