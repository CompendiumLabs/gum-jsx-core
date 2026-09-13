import { finite, nonnegative } from './checks';
import { coordinate_length, point_bounds } from './coordinates';
import type { GeometrySpace } from './coordinates';
import { arc_path, rounded_path, spline_path } from './curves';
import { draw_path } from './drawing';
import type { Paint } from './drawing';
import { Element, element_children } from './element';
import type { ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point, read_point } from './geometry';
import type { Point, Size } from './geometry';
import { exact, make_request, shape_size } from './layout';
import type { LayoutQuery } from './pass';
import type { PathCommand } from './path';
import { Circle, is_position } from './shapes';
import type { Position, PositionValue, Radius } from './shapes';
import { resolve_paint, resolve_style } from './style';
import type { StyleSpec } from './style';
import { px, resolve_length } from './units';
import type { Length } from './units';

type MarkProps = ElementProps & Readonly<{ space?: GeometrySpace }>;
type CoordLineProps = MarkProps & Readonly<{ points?: readonly (PositionValue | null)[]; closed?: boolean }>;
type SplineProps = CoordLineProps & Readonly<{ tension?: number }>;
type RoundedLineProps = CoordLineProps & Readonly<{ radius?: Length }>;
type SegmentsProps = MarkProps & Readonly<{ segments?: readonly (readonly [PositionValue, PositionValue])[] }>;
type ArcProps = MarkProps & Readonly<{ center?: PositionValue; radius?: Radius; start?: number; end?: number }>;
type FillProps = MarkProps & Readonly<{
  points?: readonly (PositionValue | null)[];
  boundary?: readonly (PositionValue | null)[] | number;
  direction?: 'vertical' | 'horizontal';
}>;
type ArrowProps = MarkProps & Readonly<{
  from?: PositionValue; to?: PositionValue; points?: readonly PositionValue[];
  start_head?: boolean; end_head?: boolean; head_size?: Length; head_width?: number;
  head_style?: StyleSpec; curve?: boolean; tension?: number; radius?: Length;
}>;
type ArrowHeadProps = MarkProps & Readonly<{
  tip?: PositionValue; angle?: number; head_size?: Length; head_width?: number; open?: boolean;
}>;
type RayProps = MarkProps & Readonly<{ origin?: PositionValue; angle?: number; length?: Length }>;
type PointSize = Length | PositionValue;
type PointsProps = MarkProps & Readonly<{
  points?: readonly (PositionValue | null)[];
  point_size?: PointSize | ((point: Position, index: number) => PointSize);
  shape?: Element | ((point: Position, index: number) => Element);
}>;
type Marker = Readonly<{ point: Position; size: PointSize; shape: Element }>;
type PointsData = MarkProps & Readonly<{ markers: readonly Marker[] }>;

// New marks use ambient data coordinates inside Graph; space="local" opts out.
// Without a Graph they use the same fractional/px/em geometry as ordinary shapes.
function mark_context(props: MarkProps, query: LayoutQuery) {
  if (element_children(props.children).length) throw new TypeError('Marks have no content children');
  if (props.space && !['local', 'data'].includes(props.space)) throw new TypeError('Unknown geometry space');
  if (props.space === 'data' && !query.coordinates) throw new TypeError('Data geometry needs Graph or Plot');
  const size = shape_size(query.request, query.sizing);
  const coord = props.space === 'local' ? undefined : query.coordinates;
  const point = (value: PositionValue) => {
    const p = read_point(value, query.path);
    return make_point(
      coordinate_length(p.x, 'x', size, query.style.font_size, coord, `${query.path}.x`),
      coordinate_length(p.y, 'y', size, query.style.font_size, coord, `${query.path}.y`));
  };
  const length = (value: Length) => nonnegative(resolve_length(value,
    { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) }, query.path), 'length');
  return { size, point, length, coord, paint: resolve_paint(query.style, size, query.path) };
}

function mark_bounds(props: MarkProps, points: readonly (PositionValue | null)[]) {
  return props.space === 'local' ? null : point_bounds(points.map(value => {
    if (value === null) return null;
    const p = read_point(value);
    return typeof p.x === 'number' && typeof p.y === 'number' ? p as Point : null;
  }));
}

// Nulls and nonfinite coordinates break paths instead of connecting across holes.
function finite_runs(points: readonly (PositionValue | null)[]): Position[][] {
  const runs: Position[][] = [];
  let run: Position[] = [];
  for (const value of points) {
    const point = value === null ? null : read_point(value);
    const valid = point && [point.x, point.y].every(v => typeof v !== 'number' || Number.isFinite(v));
    if (valid) run.push(point);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs;
}

function line_path(points: readonly Point[], closed = false): PathCommand[] {
  const path: PathCommand[] = points.map((p, i) => ({ kind: i ? 'L' : 'M', ...p }));
  if (closed && points.length > 1) path.push({ kind: 'Z' });
  return path;
}

class CoordLine extends Element<CoordLineProps> {
  static data_bounds(props: CoordLineProps) {
    return mark_bounds(props, props.points ?? []);
  }
  static layout(props: CoordLineProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query);
    const commands = finite_runs(props.points ?? []).flatMap(run => line_path(run.map(point), props.closed));
    return make_fragment({ size, draw: [draw_path(commands, paint)] });
  }
}

class Spline extends Element<SplineProps> {
  static data_bounds(props: SplineProps) {
    return mark_bounds(props, props.points ?? []);
  }
  static layout(props: SplineProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query);
    const commands = finite_runs(props.points ?? []).flatMap(run =>
      spline_path(run.map(point), props.tension, props.closed));
    return make_fragment({ size, draw: [draw_path(commands, paint)] });
  }
}

class RoundedLine extends Element<RoundedLineProps> {
  static data_bounds(props: RoundedLineProps) {
    return mark_bounds(props, props.points ?? []);
  }
  static layout(props: RoundedLineProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query);
    const commands = finite_runs(props.points ?? []).flatMap(run =>
      rounded_path(run.map(point), length(props.radius ?? px(8))));
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] });
  }
}

class Segments extends Element<SegmentsProps> {
  static data_bounds(props: SegmentsProps) {
    return mark_bounds(props, (props.segments ?? []).flat());
  }
  static layout(props: SegmentsProps, query: LayoutQuery) {
    const { size, point, paint } = mark_context(props, query);
    const commands = (props.segments ?? []).flatMap(segment => {
      if (segment.length !== 2) throw new TypeError('Each segment needs two endpoints');
      return line_path(segment.map(point));
    });
    return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] });
  }
}

class Arc extends Element<ArcProps> {
  static data_bounds(props: ArcProps) {
    const c = read_point(props.center ?? { x: 0.5, y: 0.5 }, 'center'), r = props.radius ?? 0.5;
    const pair = is_position(r) ? read_point(r, 'radius') : { x: r, y: r };
    return typeof c.x === 'number' && typeof c.y === 'number'
      && typeof pair.x === 'number' && typeof pair.y === 'number' ? mark_bounds(props, [
        { x: c.x - pair.x, y: c.y - pair.y }, { x: c.x + pair.x, y: c.y + pair.y },
      ]) : null;
  }
  static layout(props: ArcProps, query: LayoutQuery) {
    const { size, point, paint, length, coord } = mark_context(props, query);
    const center = props.center ?? { x: 0.5, y: 0.5 }, radius = props.radius ?? 0.5;
    const paired = is_position(radius);
    const pair = paired ? read_point(radius, 'radius') : { x: radius, y: radius };
    const origin = point(center);
    function delta(value: Length, axis: 'x' | 'y'): number {
      if (coord && typeof value === 'number') {
        nonnegative(value, 'radius');
        const lim = axis === 'x' ? coord.xlim : coord.ylim;
        return value / (lim[1] - lim[0]) * (axis === 'x' ? size.width : size.height)
          * ((axis === 'x' ? coord.flip_x : coord.flip_y) ? -1 : 1);
      }
      return paired
        ? nonnegative(resolve_length(value, { font_size: query.style.font_size,
          fraction: axis === 'x' ? size.width : size.height }, 'radius'), 'radius') : length(value);
    }
    const commands = arc_path(origin, make_point(delta(pair.x, 'x'), delta(pair.y, 'y')), props.start, props.end);
    return make_fragment({ size, draw: [draw_path(commands, paint)] });
  }
}

// Both boundaries share indices. A gap in either splits the entire filled region.
function fill_pairs(props: FillProps): readonly (readonly [Position, Position] | null)[] {
  const { points = [], boundary = 0, direction = 'vertical' } = props;
  if (!['vertical', 'horizontal'].includes(direction)) throw new TypeError('Unknown fill direction');
  if (typeof boundary !== 'number' && boundary.length !== points.length) {
    throw new RangeError('Fill boundaries need matching lengths');
  }
  return points.map((value, i) => {
    const point = value === null ? null : read_point(value, `points[${i}]`);
    const other = typeof boundary === 'number' && point
      ? direction === 'vertical' ? { x: point.x, y: boundary } : { x: boundary, y: point.y }
      : typeof boundary !== 'number' ? boundary[i] : null;
    const run = finite_runs([point, other])[0];
    return run?.length === 2 ? [run[0], run[1]] as const : null;
  });
}

function fill_layout(props: FillProps, query: LayoutQuery) {
  const { size, point, paint } = mark_context(props, query);
  const commands: PathCommand[] = [], pairs = fill_pairs(props);
  let run: (readonly [Position, Position])[] = [];
  function flush() {
    if (run.length > 1) {
      const path = line_path([
        ...run.map(pair => point(pair[0])), ...run.toReversed().map(pair => point(pair[1])),
      ], true);
      for (const command of path) commands.push(command);
    }
    run = [];
  }
  for (const pair of pairs) { if (pair) run.push(pair); else flush(); }
  flush();
  return make_fragment({ size, draw: [draw_path(commands, paint)] });
}

class Fill extends Element<FillProps> {
  static defaults: Partial<FillProps> = { fill: '#dbeafe', stroke: 'none' };
  static data_bounds(props: FillProps) {
    return mark_bounds(props,
      fill_pairs(props).flatMap(pair => pair ? [...pair] : []));
  }
  static layout = fill_layout;
}

class VFill extends Fill {
  static defaults: Partial<FillProps> = { direction: 'vertical' };
}

class HFill extends Fill {
  static defaults: Partial<FillProps> = { direction: 'horizontal' };
}

function arrow_head(tip: Point, angle: number, length: number, width = 0.65, open = false): PathCommand[] {
  nonnegative(width, 'head_width');
  const c = Math.cos(angle), s = Math.sin(angle);
  const corner = (side: number) => make_point(tip.x - length * c - side * length * width * s / 2,
    tip.y - length * s + side * length * width * c / 2);
  return line_path([corner(-1), tip, corner(1)], !open);
}

function arrow_points(props: ArrowProps): readonly PositionValue[] {
  return props.points ?? [props.from ?? { x: 0, y: 0 }, props.to ?? { x: 1, y: 1 }];
}

// A triangular head narrows to zero at the tip. Retreat far enough that the
// shaft's cap fits between its sides, using the resolved stroke width in pixels.
function arrow_inset(paint: Paint, length: number, width: number): number {
  const half = paint.stroke === 'none' ? 0 : paint.stroke_width / 2;
  if (!half) return 0;
  const corner = 2 * half / width;
  const cap = paint.stroke_linecap ?? 'butt';
  const inset = cap === 'round' ? Math.hypot(half, corner)
    : corner + (cap === 'square' ? half : 0);
  // A head narrower than the shaft cannot cover it. Let the cap reach the head's
  // base instead of leaving a gap by retreating farther than the whole head.
  return Math.min(inset, length + (cap === 'butt' ? 0 : half));
}

// Own the shortened route before generating a straight, rounded, or spline
// shaft. Consume short terminal segments instead of moving endpoints backwards.
function inset_route(points: readonly Point[], start: number, end: number): readonly Point[] {
  function cut(route: readonly Point[], distance: number): readonly Point[] {
    if (!distance) return route;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance < length) {
        const t = distance / length;
        return [make_point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), ...route.slice(i)];
      }
      distance -= length;
    }
    return [];
  }
  const route = cut(points, start);
  return end ? cut(route.toReversed(), end).toReversed() : route;
}

function arrow_draw(points: readonly Point[], paint: Paint, head: Paint, length: number,
  props: Pick<ArrowProps, 'start_head' | 'end_head' | 'head_width' | 'curve' | 'tension'>,
  radius = 0) {
  const distinct = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  const headed = distinct.length > 1 && length > 0;
  const start = headed && (props.start_head ?? false), end = headed && (props.end_head ?? true);
  const width = start || end ? nonnegative(props.head_width ?? 1.3, 'head_width') : 0;
  const inset = start || end ? arrow_inset(paint, length, width) : 0;
  const shaft = start || end ? inset_route(distinct, start ? inset : 0, end ? inset : 0) : points;
  const path = props.curve ? spline_path(shaft, props.tension)
    : radius ? rounded_path(shaft, radius) : line_path(shaft);
  const draw = [draw_path(path, { ...paint, fill: 'none' })];
  if (!headed) return draw;
  const add = (tip: Point, before: Point) => draw.push(draw_path(
    arrow_head(tip, Math.atan2(tip.y - before.y, tip.x - before.x), length, width), head));
  if (start) add(distinct[0], distinct[1]);
  if (end) add(distinct[distinct.length - 1], distinct[distinct.length - 2]);
  return draw;
}

class Arrow extends Element<ArrowProps> {
  static data_bounds(props: ArrowProps) {
    return mark_bounds(props, arrow_points(props));
  }
  static layout(props: ArrowProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query);
    const head = resolve_paint(resolve_style({ fill: paint.stroke, stroke: 'none', ...props.head_style },
      query.style), size, query.path);
    return make_fragment({ size, draw: arrow_draw(arrow_points(props).map(point), paint, head,
      length(props.head_size ?? px(9)), props, length(props.radius ?? 0)) });
  }
}

class ArrowHead extends Element<ArrowHeadProps> {
  static defaults: Partial<ArrowHeadProps> = { fill: 'black' };
  static data_bounds(props: ArrowHeadProps) {
    return mark_bounds(props, [props.tip ?? { x: 1, y: 0.5 }]);
  }
  static layout(props: ArrowHeadProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query);
    const commands = arrow_head(point(props.tip ?? { x: 1, y: 0.5 }),
      finite(props.angle ?? 0, 'angle') * Math.PI / 180, length(props.head_size ?? px(9)),
      props.head_width, props.open);
    return make_fragment({ size, draw: [draw_path(commands, props.open ? { ...paint, fill: 'none' } : paint)] });
  }
}

class Ray extends Element<RayProps> {
  static data_bounds(props: RayProps) {
    return mark_bounds(props, [props.origin ?? { x: 0.5, y: 0.5 }]);
  }
  static layout(props: RayProps, query: LayoutQuery) {
    const { size, point, paint, length } = mark_context(props, query);
    const origin = point(props.origin ?? { x: 0.5, y: 0.5 });
    const angle = finite(props.angle ?? 0, 'angle') * Math.PI / 180, distance = length(props.length ?? 0.5);
    const end = make_point(origin.x + distance * Math.cos(angle), origin.y + distance * Math.sin(angle));
    return make_fragment({ size, draw: [draw_path(line_path([origin, end]), { ...paint, fill: 'none' })] });
  }
}

class Points extends Element<PointsData, PointsProps> {
  static defaults: Partial<PointsData> = { fill: 'black', stroke: 'none' };
  static normalize({ points = [], point_size = px(6), shape = new Circle(), ...props }: PointsProps): PointsData {
    return { ...props,
      markers: points.flatMap((value, index) => {
        const point = finite_runs([value])[0]?.[0];
        return point ? [{ point,
          size: typeof point_size === 'function' ? point_size(point, index) : point_size,
          shape: typeof shape === 'function' ? shape(point, index) : shape }] : [];
      }),
    };
  }
  static data_bounds(props: PointsData) {
    return mark_bounds(props, props.markers.map(marker => marker.point));
  }
  static layout(props: PointsData, query: LayoutQuery) {
    const { size, point } = mark_context(props, query);
    const children = props.markers.map((marker, index) => {
      const paired = is_position(marker.size);
      const pair = paired
        ? read_point(marker.size, 'point_size') : { x: marker.size, y: marker.size };
      const dimension = (value: Length, fraction: number) => nonnegative(resolve_length(value,
        { font_size: query.style.font_size, fraction }, 'point_size'), 'point_size');
      const width = dimension(pair.x, paired ? size.width : Math.min(size.width, size.height));
      const height = dimension(pair.y, paired ? size.height : Math.min(size.width, size.height));
      const fragment = query.child(marker.shape, make_request({ width: exact(width), height: exact(height) }),
        { width, height }, index, { coordinates: null });
      const center = point(marker.point);
      return place_fragment(fragment, make_point(center.x - width / 2, center.y - height / 2));
    });
    return make_fragment({ size, children });
  }
}

export { CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill,
  Arrow, ArrowHead, Ray, Points, mark_context, mark_bounds, finite_runs, line_path, arrow_draw };
export type { MarkProps, CoordLineProps, SplineProps, RoundedLineProps, SegmentsProps,
  ArcProps, FillProps, ArrowProps, ArrowHeadProps, RayProps, PointSize, PointsProps };
