import { nonnegative } from './checks';
import { DEFAULTS } from './defaults';
import { draw_rect, draw_ellipse, draw_path } from './drawing';
import { define_element, element_children } from './element';
import type { ElementProps } from './element';
import { make_fragment } from './fragment';
import { make_point, make_rect } from './geometry';
import type { Size } from './geometry';
import { shape_size } from './layout';
import type { LayoutQuery } from './pass';
import { map_path } from './path';
import type { PathCommand, PathSegment } from './path';
import { resolve_paint } from './style';
import { resolve_length } from './units';
import type { Length } from './units';

type Position = Readonly<{ x: Length; y: Length }>;
type Radius = Length | Position;
type RectProps = ElementProps & Readonly<{ radius?: Radius }>;
type CircleProps = ElementProps & Readonly<{ center?: Position; radius?: Length }>;
type EllipseProps = ElementProps & Readonly<{ center?: Position; radius?: Position }>;
type LineProps = ElementProps & Readonly<{ from?: Position; to?: Position }>;
type PolylineProps = ElementProps & Readonly<{ points?: readonly Position[] }>;
type PolygonProps = PolylineProps;
type PathProps = ElementProps & Readonly<{ commands?: readonly PathSegment[] }>;

// Geometry references the shape's own rectangle, after shared sizing has finished.
function shape_context(props: ElementProps, query: LayoutQuery) {
  if (element_children(props.children).length) throw new TypeError('Shapes have no content children');
  const size = shape_size(query.request, query.sizing);
  const paint = resolve_paint(query.style, size, query.path);
  return { size, paint };
}

function resolve_position(point: Position, size: Size, query: LayoutQuery, path: string) {
  const { font_size } = query.style;
  return make_point(
    resolve_length(point.x, { font_size, fraction: size.width }, `${query.path}.${path}.x`),
    resolve_length(point.y, { font_size, fraction: size.height }, `${query.path}.${path}.y`),
  );
}

// A scalar radius stays circular; a pair resolves against the corresponding axes.
function resolve_radius(radius: Radius, size: Size, query: LayoutQuery) {
  if (typeof radius === 'object' && 'x' in radius) {
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

const Rect = define_element<RectProps>('Rect', rect_layout);
const RoundedRect = define_element<RectProps>('RoundedRect', (props, query) =>
  rect_layout(props, query, DEFAULTS.rounded_radius));

const Circle = define_element<CircleProps>('Circle', (props, query) => {
  const { size, paint } = shape_context(props, query);
  const center = resolve_position(props.center ?? { x: 0.5, y: 0.5 }, size, query, 'center');
  const radius = resolve_radius(props.radius ?? 0.5, size, query);
  return make_fragment({ size, draw: [draw_ellipse(center, radius, paint)] });
});

const Ellipse = define_element<EllipseProps>('Ellipse', (props, query) => {
  const { size, paint } = shape_context(props, query);
  const center = resolve_position(props.center ?? { x: 0.5, y: 0.5 }, size, query, 'center');
  const radius = resolve_radius(props.radius ?? { x: 0.5, y: 0.5 }, size, query);
  return make_fragment({ size, draw: [draw_ellipse(center, radius, paint)] });
});

const Line = define_element<LineProps>('Line', (props, query) => {
  const { size, paint } = shape_context(props, query);
  const from = resolve_position(props.from ?? { x: 0, y: 0 }, size, query, 'from');
  const to = resolve_position(props.to ?? { x: 1, y: 1 }, size, query, 'to');
  const commands: PathCommand[] = [{ kind: 'M', ...from }, { kind: 'L', ...to }];
  return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] });
});

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

const Polyline = define_element<PolylineProps>('Polyline', poly_layout);
const Polygon = define_element<PolygonProps>('Polygon', (props, query) =>
  poly_layout(props, query, true));

const Path = define_element<PathProps>('Path', (props, query) => {
  const { size, paint } = shape_context(props, query);
  const commands = map_path(props.commands ?? [], (x, y) =>
    resolve_position({ x, y }, size, query, 'commands'));
  return make_fragment({ size, draw: [draw_path(commands, paint)] });
});

export { Rect, RoundedRect, Circle, Ellipse, Line, Polyline, Polygon, Path };
export type { Position, Radius, RectProps, CircleProps, EllipseProps,
  LineProps, PolylineProps, PolygonProps, PathProps };
