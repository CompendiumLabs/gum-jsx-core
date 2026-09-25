import { nonnegative } from '../lib/checks'
import { DEFAULTS } from '../engine/defaults'
import { coordinate_point, point_bounds } from '../engine/coordinates'
import type { GeometrySpace } from '../engine/coordinates'
import { draw_rect, draw_ellipse, draw_path } from '../engine/drawing'
import { Element, define_component, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, frame_connection } from '../engine/fragment'
import { make_size, make_point, make_rect, make_clip, read_point } from '../engine/geometry'
import type { Point, PointValue, Size, RectRadii } from '../engine/geometry'
import { shape_size } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { map_path } from '../engine/path'
import type { PathCommand, PathSegment } from '../engine/path'
import { resolve_paint } from '../engine/style'
import { px, resolve_length } from '../engine/units'
import type { Length, LengthContext } from '../engine/units'

type Position = Readonly<{ x: Length; y: Length }>
type PositionValue = PointValue<Length>
type Radius = Length | PositionValue
type RadiusSides = Readonly<Partial<Record<'t' | 'b' | 'l' | 'r' | 'tl' | 'tr' | 'bl' | 'br', Radius>>>
type RectRadius = Radius | RadiusSides
type RectProps = ElementProps & Readonly<{ border_radius?: RectRadius }>
type CircleProps = ElementProps & Readonly<{ center?: PositionValue; radius?: Length }>
type EllipseProps = ElementProps & Readonly<{ center?: PositionValue; radius?: PositionValue }>
type LineProps = ElementProps & Readonly<{ from?: PositionValue; to?: PositionValue; space?: GeometrySpace }>
type PolygonProps = ElementProps & Readonly<{ points?: readonly PositionValue[] }>
type PolylineProps = PolygonProps & Readonly<{ space?: GeometrySpace }>
type PathProps = ElementProps & Readonly<{ commands?: readonly PathSegment[] }>

// Only shapes with an intrinsic ratio supply a default aspect. Geometry references
// the shape's own rectangle, after shared sizing has finished.
function shape_context(props: ElementProps, query: LayoutQuery, aspect?: number) {
  if (element_children(props.children).length) throw new TypeError('Shapes have no content children')
  const sizing = { ...query.sizing, aspect: query.sizing.aspect ?? aspect }
  const size = shape_size(query.request, sizing)
  const paint = resolve_paint(query.style, size, query.measure)
  return { size, paint }
}

function resolve_position(value: PositionValue, size: Size, measure: LengthContext, path: string) {
  const point = read_point(value, `${measure.path}.${path}`)
  return make_point(
    resolve_length(point.x, measure, size.width, `${path}.x`),
    resolve_length(point.y, measure, size.height, `${path}.y`),
  )
}

// These shapes keep their local default and explicitly opt into pairwise data mapping.
function line_point(query: LayoutQuery, size: Size, space: GeometrySpace = 'local') {
  if (!['local', 'data'].includes(space)) throw new TypeError('Unknown geometry space')
  if (space === 'data' && !query.coordinates) throw new TypeError('Data geometry needs a coordinate context such as Graph or Plot')
  return (value: PositionValue, path: string) => space === 'local'
    ? resolve_position(value, size, query.measure, path)
    : coordinate_point(read_point(value, `${query.measure.path}.${path}`), size, query.measure, query.coordinates)
}

function line_bounds(space: GeometrySpace | undefined, points: readonly PositionValue[]) {
  if (space !== 'data') return null
  return point_bounds(points.map(value => {
    const point = read_point(value)
    return typeof point.x === 'number' && typeof point.y === 'number' ? point as Point : null
  }))
}

// Unit records are scalar lengths; coordinate records and tuples are pairs.
function is_position(value: Radius): value is PositionValue {
  return value !== null && typeof value === 'object' && !('unit' in value)
}

// A scalar radius stays circular; a pair resolves against the corresponding axes.
function resolve_radius(radius: Radius, size: Size, measure: LengthContext, path = 'radius') {
  if (is_position(radius)) {
    const point = resolve_position(radius, size, measure, path)
    nonnegative(point.x, `${path}.x`); nonnegative(point.y, `${path}.y`)
    return point
  }
  const value = nonnegative(resolve_length(radius, measure, Math.min(size.width, size.height), path), path)
  return make_point(value, value)
}

// Explicit corners win over sides; top/bottom win where side defaults overlap.
function resolve_rect_radius(radius: RectRadius, size: Size, measure: LengthContext): RectRadii {
  if (radius !== null && typeof radius === 'object' && !Array.isArray(radius)
    && !('unit' in radius) && !('x' in radius) && !('y' in radius)) {
    const sides = radius as RadiusSides
    for (const key of Object.keys(sides)) {
      if (!['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'].includes(key)) {
        throw new TypeError(`${measure.path}.border_radius: unknown side or corner ${key}`)
      }
    }
    const resolved = Object.fromEntries(Object.entries(sides).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, resolve_radius(value!, size, measure, `border_radius.${key}`)]))
    const zero = make_point()
    return Object.freeze({
      tl: resolved.tl ?? resolved.t ?? resolved.l ?? zero,
      tr: resolved.tr ?? resolved.t ?? resolved.r ?? zero,
      br: resolved.br ?? resolved.b ?? resolved.r ?? zero,
      bl: resolved.bl ?? resolved.b ?? resolved.l ?? zero,
    })
  }
  return resolve_radius(radius as Radius, size, measure, 'border_radius')
}

// Edges meet the drawn ellipse: a clip whose corner radii span its whole box.
function ellipse_boundary(center: Point, radius: Point) {
  return make_clip(make_rect(center.x - radius.x, center.y - radius.y, 2 * radius.x, 2 * radius.y), radius)
}

// Rect and RoundedRect share geometry; the latter supplies a convenient default.
function rect_layout(props: RectProps, query: LayoutQuery, radius: Radius = 0) {
  const { size, paint } = shape_context(props, query)
  const rect = make_rect(0, 0, size.width, size.height)
  const corners = resolve_rect_radius(props.border_radius ?? radius, size, query.measure)
  return make_fragment({ size, draw: [draw_rect(rect, paint, corners)],
    ...frame_connection(props.id, make_clip(rect, corners)) })
}

class Rect extends Element<RectProps> {
  static layout = rect_layout
}

class RoundedRect extends Element<RectProps> {
  static layout(props: RectProps, query: LayoutQuery) {
    return rect_layout(props, query, DEFAULTS.rounded_radius)
  }
}

// Like Circle, Square keeps its geometry square inside a nonsquare allocation.
class Square extends Element<RectProps> {
  static layout(props: RectProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query, 1)
    const side = Math.min(size.width, size.height)
    const rect = make_rect((size.width - side) / 2, (size.height - side) / 2, side, side)
    const radius = resolve_rect_radius(props.border_radius ?? 0, make_size(side, side), query.measure)
    return make_fragment({ size, draw: [draw_rect(rect, paint, radius)],
      ...frame_connection(props.id, make_clip(rect, radius)) })
  }
}

class Circle extends Element<CircleProps> {
  static layout(props: CircleProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query, 1)
    const center = resolve_position(props.center ?? { x: 0.5, y: 0.5 }, size, query.measure, 'center')
    const radius = resolve_radius(props.radius ?? 0.5, size, query.measure)
    return make_fragment({ size, draw: [draw_ellipse(center, radius, paint)],
      ...frame_connection(props.id, ellipse_boundary(center, radius)) })
  }
}

class Ellipse extends Element<EllipseProps> {
  static layout(props: EllipseProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query)
    const center = resolve_position(props.center ?? { x: 0.5, y: 0.5 }, size, query.measure, 'center')
    const radius = resolve_radius(props.radius ?? { x: 0.5, y: 0.5 }, size, query.measure)
    return make_fragment({ size, draw: [draw_ellipse(center, radius, paint)],
      ...frame_connection(props.id, ellipse_boundary(center, radius)) })
  }
}

class Line extends Element<LineProps> {
  static data_bounds(props: LineProps) {
    return line_bounds(props.space, [props.from ?? [0, 0], props.to ?? [1, 1]])
  }
  static layout(props: LineProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query)
    const point = line_point(query, size, props.space)
    const from = point(props.from ?? { x: 0, y: 0 }, 'from')
    const to = point(props.to ?? { x: 1, y: 1 }, 'to')
    const commands: PathCommand[] = from && to ? [{ kind: 'M', ...from }, { kind: 'L', ...to }] : []
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] })
  }
}

// Closing is a path command, so the same point handling serves both primitives.
function poly_layout(props: PolygonProps, query: LayoutQuery, closed = false, space: GeometrySpace = 'local') {
  const { size, paint } = shape_context(props, query)
  const point = line_point(query, size, space)
  const commands: PathCommand[] = []
  let started = false
  for (const [index, value] of (props.points ?? []).entries()) {
    const projected = point(value, `points[${index}]`)
    if (!projected) { started = false; continue; }
    commands.push({ kind: started ? 'L' : 'M', ...projected })
    started = true
  }
  if (closed && commands.length > 1) commands.push({ kind: 'Z' })
  return make_fragment({ size, draw: [draw_path(commands, paint)] })
}

class Polyline extends Element<PolylineProps> {
  static data_bounds(props: PolylineProps) {
    return line_bounds(props.space, props.points ?? [])
  }
  static layout(props: PolylineProps, query: LayoutQuery) {
    return poly_layout(props, query, false, props.space)
  }
}

class Polygon extends Element<PolygonProps> {
  static layout(props: PolygonProps, query: LayoutQuery) {
    return poly_layout(props, query, true)
  }
}

class Path extends Element<PathProps> {
  static layout(props: PathProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query)
    const commands = map_path(props.commands ?? [], (x, y) =>
      resolve_position({ x, y }, size, query.measure, 'commands'))
    return make_fragment({ size, draw: [draw_path(commands, paint)] })
  }
}

const UnitLine = define_component<LineProps>('UnitLine', props => new Line({
  from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, ...props,
}))
const HLine = define_component<LineProps>('HLine', props => new Line({
  from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, ...props,
}))
const VLine = define_component<LineProps>('VLine', props => new Line({
  from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, ...props,
}))
const Dot = define_component<CircleProps>('Dot', props => new Circle({
  width: px(6), height: px(6), fill: 'theme:foreground', stroke: 'none', ...props,
}))
const Triangle = define_component<PolygonProps>('Triangle', props => new Polygon({
  points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], ...props,
}))

export { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path,
  resolve_radius, resolve_rect_radius, is_position,
  UnitLine, HLine, VLine, Dot, Triangle }
export type { Position, PositionValue, Radius, RadiusSides, RectRadius, RectProps, CircleProps, EllipseProps,
  LineProps, PolylineProps, PolygonProps, PathProps }
