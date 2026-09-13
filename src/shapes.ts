import { nonnegative } from './checks';
import { DEFAULTS } from './defaults';
import { draw_rect, draw_ellipse, draw_path } from './drawing';
import { Element, define_component, element_children } from './element';
import type { ElementProps } from './element';
import { make_fragment } from './fragment';
import { make_size, make_point, make_rect, read_point } from './geometry';
import type { PointValue, Size } from './geometry';
import { shape_size } from './layout';
import type { LayoutQuery } from './pass';
import { map_path } from './path';
import type { PathCommand, PathSegment } from './path';
import { resolve_paint } from './style';
import { px, resolve_length } from './units';
import type { Length } from './units';

type Position = Readonly<{ x: Length; y: Length }>;
type PositionValue = PointValue<Length>;
type Radius = Length | PositionValue;
type RectProps = ElementProps & Readonly<{ radius?: Radius }>;
type CircleProps = ElementProps & Readonly<{ center?: PositionValue; radius?: Length }>;
type EllipseProps = ElementProps & Readonly<{ center?: PositionValue; radius?: PositionValue }>;
type LineProps = ElementProps & Readonly<{ from?: PositionValue; to?: PositionValue }>;
type PolylineProps = ElementProps & Readonly<{ points?: readonly PositionValue[] }>;
type PolygonProps = PolylineProps;
type PathProps = ElementProps & Readonly<{ commands?: readonly PathSegment[] }>;

// Only shapes with an intrinsic ratio supply a default aspect. Geometry references
// the shape's own rectangle, after shared sizing has finished.
function shape_context(props: ElementProps, query: LayoutQuery, aspect?: number) {
  if (element_children(props.children).length) throw new TypeError('Shapes have no content children');
  const sizing = { ...query.sizing, aspect: query.sizing.aspect ?? aspect };
  const size = shape_size(query.request, sizing);
  const paint = resolve_paint(query.style, size, query.path);
  return { size, paint };
}

function resolve_position(value: PositionValue, size: Size, query: LayoutQuery, path: string) {
  const point = read_point(value, `${query.path}.${path}`);
  const { font_size } = query.style;
  return make_point(
    resolve_length(point.x, { font_size, fraction: size.width }, `${query.path}.${path}.x`),
    resolve_length(point.y, { font_size, fraction: size.height }, `${query.path}.${path}.y`),
  );
}

// Unit records are scalar lengths; coordinate records and tuples are pairs.
function is_position(value: Radius): value is PositionValue {
  return value !== null && typeof value === 'object' && !('unit' in value);
}

// A scalar radius stays circular; a pair resolves against the corresponding axes.
function resolve_radius(radius: Radius, size: Size, query: LayoutQuery) {
  if (is_position(radius)) {
    const point = resolve_position(radius, size, query, 'radius');
    nonnegative(point.x, 'radius.x'); nonnegative(point.y, 'radius.y');
    return point;
  }
  const basis = { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) };
  const value = nonnegative(resolve_length(radius, basis, `${query.path}.radius`), 'radius');
  return make_point(value, value);
}

// Rect and RoundedRect share geometry; the latter supplies a convenient default.
function rect_layout(props: RectProps, query: LayoutQuery, radius: Radius = 0) {
  const { size, paint } = shape_context(props, query);
  const rect = make_rect(0, 0, size.width, size.height);
  const corners = resolve_radius(props.radius ?? radius, size, query);
  return make_fragment({ size, draw: [draw_rect(rect, paint, corners)] });
}

class Rect extends Element<RectProps> {
  static layout = rect_layout;
}

class RoundedRect extends Element<RectProps> {
  static layout(props: RectProps, query: LayoutQuery) {
    return rect_layout(props, query, DEFAULTS.rounded_radius);
  }
}

// Like Circle, Square keeps its geometry square inside a nonsquare allocation.
class Square extends Element<RectProps> {
  static layout(props: RectProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query, 1);
    const side = Math.min(size.width, size.height);
    const rect = make_rect((size.width - side) / 2, (size.height - side) / 2, side, side);
    const radius = resolve_radius(props.radius ?? 0, make_size(side, side), query);
    return make_fragment({ size, draw: [draw_rect(rect, paint, radius)] });
  }
}

class Circle extends Element<CircleProps> {
  static layout(props: CircleProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query, 1);
    const center = resolve_position(props.center ?? { x: 0.5, y: 0.5 }, size, query, 'center');
    const radius = resolve_radius(props.radius ?? 0.5, size, query);
    return make_fragment({ size, draw: [draw_ellipse(center, radius, paint)] });
  }
}

class Ellipse extends Element<EllipseProps> {
  static layout(props: EllipseProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query);
    const center = resolve_position(props.center ?? { x: 0.5, y: 0.5 }, size, query, 'center');
    const radius = resolve_radius(props.radius ?? { x: 0.5, y: 0.5 }, size, query);
    return make_fragment({ size, draw: [draw_ellipse(center, radius, paint)] });
  }
}

class Line extends Element<LineProps> {
  static layout(props: LineProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query);
    const from = resolve_position(props.from ?? { x: 0, y: 0 }, size, query, 'from');
    const to = resolve_position(props.to ?? { x: 1, y: 1 }, size, query, 'to');
    const commands: PathCommand[] = [{ kind: 'M', ...from }, { kind: 'L', ...to }];
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] });
  }
}

// Closing is a path command, so the same point handling serves both primitives.
function poly_layout(props: PolylineProps, query: LayoutQuery, closed = false) {
  const { size, paint } = shape_context(props, query);
  const commands: PathCommand[] = (props.points ?? []).map((point, index) => ({
    kind: index === 0 ? 'M' : 'L',
    ...resolve_position(point, size, query, `points[${index}]`),
  }));
  if (closed && commands.length > 1) commands.push({ kind: 'Z' });
  return make_fragment({ size, draw: [draw_path(commands, paint)] });
}

class Polyline extends Element<PolylineProps> {
  static layout = poly_layout;
}

class Polygon extends Element<PolygonProps> {
  static layout(props: PolygonProps, query: LayoutQuery) {
    return poly_layout(props, query, true);
  }
}

class Path extends Element<PathProps> {
  static layout(props: PathProps, query: LayoutQuery) {
    const { size, paint } = shape_context(props, query);
    const commands = map_path(props.commands ?? [], (x, y) =>
      resolve_position({ x, y }, size, query, 'commands'));
    return make_fragment({ size, draw: [draw_path(commands, paint)] });
  }
}

const UnitLine = define_component<LineProps>('UnitLine', props => new Line({
  from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, ...props,
}));
const HLine = define_component<LineProps>('HLine', props => new Line({
  from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, ...props,
}));
const VLine = define_component<LineProps>('VLine', props => new Line({
  from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 }, ...props,
}));
const Dot = define_component<CircleProps>('Dot', props => new Circle({
  width: px(6), height: px(6), fill: 'black', stroke: 'none', ...props,
}));
const Triangle = define_component<PolygonProps>('Triangle', props => new Polygon({
  points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], ...props,
}));

export { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path, resolve_radius, is_position,
  UnitLine, HLine, VLine, Dot, Triangle };
export type { Position, PositionValue, Radius, RectProps, CircleProps, EllipseProps,
  LineProps, PolylineProps, PolygonProps, PathProps };
