import { finite, nonnegative } from './checks';
import { coordinate_length, point_bounds } from './coordinates';
import type { GeometrySpace } from './coordinates';
import { arc_path, rounded_path, spline_path } from './curves';
import { draw_path } from './drawing';
import type { Paint } from './drawing';
import { define_element, element_children } from './element';
import type { Element, ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point } from './geometry';
import type { Point, Size } from './geometry';
import { exact, make_request, shape_size } from './layout';
import type { LayoutQuery } from './pass';
import type { PathCommand } from './path';
import { Circle } from './shapes';
import type { Position, Radius } from './shapes';
import { resolve_paint, resolve_style } from './style';
import type { StyleSpec } from './style';
import { px, resolve_length } from './units';
import type { Length } from './units';

type MarkProps = ElementProps & Readonly<{ space?: GeometrySpace }>;
type CoordLineProps = MarkProps & Readonly<{ points?: readonly (Position | null)[]; closed?: boolean }>;
type SplineProps = CoordLineProps & Readonly<{ tension?: number }>;
type RoundedLineProps = CoordLineProps & Readonly<{ radius?: Length }>;
type SegmentsProps = MarkProps & Readonly<{ segments?: readonly (readonly [Position, Position])[] }>;
type ArcProps = MarkProps & Readonly<{ center?: Position; radius?: Radius; start?: number; end?: number }>;
type FillProps = MarkProps & Readonly<{
  points?: readonly (Position | null)[];
  boundary?: readonly (Position | null)[] | number;
  direction?: 'vertical' | 'horizontal';
}>;
type ArrowProps = MarkProps & Readonly<{
  from?: Position; to?: Position; points?: readonly Position[];
  start_head?: boolean; end_head?: boolean; head_size?: Length; head_width?: number;
  head_style?: StyleSpec; curve?: boolean; tension?: number; radius?: Length;
}>;
type ArrowHeadProps = MarkProps & Readonly<{
  tip?: Position; angle?: number; head_size?: Length; head_width?: number; open?: boolean;
}>;
type RayProps = MarkProps & Readonly<{ origin?: Position; angle?: number; length?: Length }>;
type PointSize = Length | Position;
type PointsProps = MarkProps & Readonly<{
  points?: readonly (Position | null)[];
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
  const point = (p: Position) => make_point(
    coordinate_length(p.x, 'x', size, query.style.font_size, coord, `${query.path}.x`),
    coordinate_length(p.y, 'y', size, query.style.font_size, coord, `${query.path}.y`));
  const length = (value: Length) => nonnegative(resolve_length(value,
    { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) }, query.path), 'length');
  return { size, point, length, coord, paint: resolve_paint(query.style, size, query.path) };
}

function mark_bounds(props: MarkProps, points: readonly (Position | null)[]) {
  return props.space === 'local' ? null : point_bounds(points.map(p => p
    && typeof p.x === 'number' && typeof p.y === 'number' ? p as Point : null));
}

// Nulls and nonfinite coordinates break paths instead of connecting across holes.
function finite_runs<T extends Position>(points: readonly (T | null)[]): T[][] {
  const runs: T[][] = [];
  let run: T[] = [];
  for (const point of points) {
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

const CoordLine = define_element<CoordLineProps>('CoordLine', (props, query) => {
  const { size, point, paint } = mark_context(props, query);
  const commands = finite_runs(props.points ?? []).flatMap(run => line_path(run.map(point), props.closed));
  return make_fragment({ size, draw: [draw_path(commands, paint)] });
}, {}, { data_bounds: props => mark_bounds(props, props.points ?? []) });

const Spline = define_element<SplineProps>('Spline', (props, query) => {
  const { size, point, paint } = mark_context(props, query);
  const commands = finite_runs(props.points ?? []).flatMap(run =>
    spline_path(run.map(point), props.tension, props.closed));
  return make_fragment({ size, draw: [draw_path(commands, paint)] });
}, {}, { data_bounds: props => mark_bounds(props, props.points ?? []) });

const RoundedLine = define_element<RoundedLineProps>('RoundedLine', (props, query) => {
  const { size, point, paint, length } = mark_context(props, query);
  const commands = finite_runs(props.points ?? []).flatMap(run =>
    rounded_path(run.map(point), length(props.radius ?? px(8))));
  return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] });
}, {}, { data_bounds: props => mark_bounds(props, props.points ?? []) });

const Segments = define_element<SegmentsProps>('Segments', (props, query) => {
  const { size, point, paint } = mark_context(props, query);
  const commands = (props.segments ?? []).flatMap(segment => {
    if (segment.length !== 2) throw new TypeError('Each segment needs two endpoints');
    return line_path(segment.map(point));
  });
  return make_fragment({ size, draw: [draw_path(commands, { ...paint, fill: 'none' })] });
}, {}, { data_bounds: props => mark_bounds(props, (props.segments ?? []).flat()) });

const Arc = define_element<ArcProps>('Arc', (props, query) => {
  const { size, point, paint, length, coord } = mark_context(props, query);
  const center = props.center ?? { x: 0.5, y: 0.5 }, radius = props.radius ?? 0.5;
  const pair = typeof radius === 'object' && 'x' in radius ? radius : { x: radius, y: radius };
  const origin = point(center);
  function delta(value: Length, axis: 'x' | 'y'): number {
    if (coord && typeof value === 'number') {
      nonnegative(value, 'radius');
      const lim = axis === 'x' ? coord.xlim : coord.ylim;
      return value / (lim[1] - lim[0]) * (axis === 'x' ? size.width : size.height)
        * ((axis === 'x' ? coord.flip_x : coord.flip_y) ? -1 : 1);
    }
    return typeof radius === 'object' && 'x' in radius
      ? nonnegative(resolve_length(value, { font_size: query.style.font_size,
        fraction: axis === 'x' ? size.width : size.height }, 'radius'), 'radius') : length(value);
  }
  const commands = arc_path(origin, make_point(delta(pair.x, 'x'), delta(pair.y, 'y')), props.start, props.end);
  return make_fragment({ size, draw: [draw_path(commands, paint)] });
}, {}, { data_bounds: props => {
  const c = props.center ?? { x: 0.5, y: 0.5 }, r = props.radius ?? 0.5;
  const pair = typeof r === 'object' && 'x' in r ? r : { x: r, y: r };
  return typeof c.x === 'number' && typeof c.y === 'number'
    && typeof pair.x === 'number' && typeof pair.y === 'number' ? mark_bounds(props, [
      { x: c.x - pair.x, y: c.y - pair.y }, { x: c.x + pair.x, y: c.y + pair.y },
    ]) : null;
} });

// Both boundaries share indices. A gap in either splits the entire filled region.
function fill_pairs(props: FillProps): readonly (readonly [Position, Position] | null)[] {
  const { points = [], boundary = 0, direction = 'vertical' } = props;
  if (!['vertical', 'horizontal'].includes(direction)) throw new TypeError('Unknown fill direction');
  if (typeof boundary !== 'number' && boundary.length !== points.length) {
    throw new RangeError('Fill boundaries need matching lengths');
  }
  return points.map((point, i) => {
    const other = typeof boundary === 'number' && point
      ? direction === 'vertical' ? { x: point.x, y: boundary } : { x: boundary, y: point.y }
      : typeof boundary !== 'number' ? boundary[i] : null;
    return point && other && finite_runs([point, other])[0]?.length === 2 ? [point, other] as const : null;
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
const fill_options = { data_bounds: (props: FillProps) => mark_bounds(props,
  fill_pairs(props).flatMap(pair => pair ? [...pair] : [])) };
const Fill = define_element<FillProps>('Fill', fill_layout, { fill: '#dbeafe', stroke: 'none' }, fill_options);
const VFill = define_element<FillProps>('VFill', fill_layout,
  { fill: '#dbeafe', stroke: 'none', direction: 'vertical' }, fill_options);
const HFill = define_element<FillProps>('HFill', fill_layout,
  { fill: '#dbeafe', stroke: 'none', direction: 'horizontal' }, fill_options);

function arrow_head(tip: Point, angle: number, length: number, width = 0.65, open = false): PathCommand[] {
  nonnegative(width, 'head_width');
  const c = Math.cos(angle), s = Math.sin(angle);
  const corner = (side: number) => make_point(tip.x - length * c - side * length * width * s / 2,
    tip.y - length * s + side * length * width * c / 2);
  return line_path([corner(-1), tip, corner(1)], !open);
}

function arrow_points(props: ArrowProps): readonly Position[] {
  return props.points ?? [props.from ?? { x: 0, y: 0 }, props.to ?? { x: 1, y: 1 }];
}

function arrow_draw(points: readonly Point[], paint: Paint, head: Paint, length: number,
  props: Pick<ArrowProps, 'start_head' | 'end_head' | 'head_width' | 'curve' | 'tension'>,
  radius = 0) {
  const path = props.curve ? spline_path(points, props.tension)
    : radius ? rounded_path(points, radius) : line_path(points);
  const draw = [draw_path(path, { ...paint, fill: 'none' })];
  const distinct = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (distinct.length < 2 || !length) return draw;
  const add = (tip: Point, before: Point) => draw.push(draw_path(
    arrow_head(tip, Math.atan2(tip.y - before.y, tip.x - before.x), length, props.head_width), head));
  if (props.start_head) add(distinct[0], distinct[1]);
  if (props.end_head ?? true) add(distinct[distinct.length - 1], distinct[distinct.length - 2]);
  return draw;
}

const Arrow = define_element<ArrowProps>('Arrow', (props, query) => {
  const { size, point, paint, length } = mark_context(props, query);
  const head = resolve_paint(resolve_style({ fill: paint.stroke, stroke: 'none', ...props.head_style },
    query.style), size, query.path);
  return make_fragment({ size, draw: arrow_draw(arrow_points(props).map(point), paint, head,
    length(props.head_size ?? px(9)), props, length(props.radius ?? 0)) });
}, {}, { data_bounds: props => mark_bounds(props, arrow_points(props)) });

const ArrowHead = define_element<ArrowHeadProps>('ArrowHead', (props, query) => {
  const { size, point, paint, length } = mark_context(props, query);
  const commands = arrow_head(point(props.tip ?? { x: 1, y: 0.5 }),
    finite(props.angle ?? 0, 'angle') * Math.PI / 180, length(props.head_size ?? px(9)),
    props.head_width, props.open);
  return make_fragment({ size, draw: [draw_path(commands, props.open ? { ...paint, fill: 'none' } : paint)] });
}, { fill: 'black' }, { data_bounds: props => mark_bounds(props, [props.tip ?? { x: 1, y: 0.5 }]) });

const Ray = define_element<RayProps>('Ray', (props, query) => {
  const { size, point, paint, length } = mark_context(props, query);
  const origin = point(props.origin ?? { x: 0.5, y: 0.5 });
  const angle = finite(props.angle ?? 0, 'angle') * Math.PI / 180, distance = length(props.length ?? 0.5);
  const end = make_point(origin.x + distance * Math.cos(angle), origin.y + distance * Math.sin(angle));
  return make_fragment({ size, draw: [draw_path(line_path([origin, end]), { ...paint, fill: 'none' })] });
}, {}, { data_bounds: props => mark_bounds(props, [props.origin ?? { x: 0.5, y: 0.5 }]) });

const Points = define_element<PointsData, PointsProps>('Points', (props, query) => {
  const { size, point } = mark_context(props, query);
  const children = props.markers.map((marker, index) => {
    const paired = typeof marker.size === 'object' && 'x' in marker.size;
    const pair = paired
      ? marker.size : { x: marker.size, y: marker.size };
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
}, { fill: 'black', stroke: 'none' }, {
  normalize: ({ points = [], point_size = px(6), shape = new Circle(), ...props }) => ({ ...props,
    markers: points.flatMap((point, index) => finite_runs([point]).length ? [{ point: point!,
      size: typeof point_size === 'function' ? point_size(point!, index) : point_size,
      shape: typeof shape === 'function' ? shape(point!, index) : shape }] : []),
  }),
  data_bounds: props => mark_bounds(props, props.markers.map(marker => marker.point)),
});

export { CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill,
  Arrow, ArrowHead, Ray, Points, mark_context, mark_bounds, finite_runs, line_path, arrow_draw };
export type { MarkProps, CoordLineProps, SplineProps, RoundedLineProps, SegmentsProps,
  ArcProps, FillProps, ArrowProps, ArrowHeadProps, RayProps, PointSize, PointsProps };
