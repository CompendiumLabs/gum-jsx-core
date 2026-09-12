import { finite, nonnegative } from './checks';
import { copy_limit, infer_coordinates, map_axis } from './coordinates';
import type { Limit } from './coordinates';
import { draw_path } from './drawing';
import { define_element, Element } from './element';
import type { ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point } from './geometry';
import { make_request, shape_size } from './layout';
import { arrow_draw, line_path } from './marks';
import { Rotate } from './placement';
import type { Side } from './placement';
import { resolve_style, resolve_paint } from './style';
import type { StyleSpec } from './style';
import { Text } from './text';
import { linear_ticks, format_tick } from './ticks';
import { px, resolve_length } from './units';
import type { Length } from './units';
import type { LayoutQuery } from './pass';

type Tick = number | readonly [number, string | number | Element];
type TickSpec = number | readonly Tick[];
type AxisProps = ElementProps & Readonly<{
  lim?: Limit; ticks?: TickSpec; interval?: number; side?: Side; at?: number;
  tick_size?: Length; label_offset?: Length; rotate?: number;
  labels?: boolean; line?: boolean; arrow?: boolean;
  format?: (value: number, index: number) => string;
  line_style?: StyleSpec; tick_style?: StyleSpec; label_style?: StyleSpec;
}>;
type AxisItem = Readonly<{ value: number; label: Element }>;
type AxisData = Omit<AxisProps, 'ticks' | 'format'> & Readonly<{ items: readonly AxisItem[]; lim: Limit }>;
type LabelProps = Omit<AxisProps, 'ticks'> & Readonly<{ value?: number; label?: string | number | Element }>;
type MeshProps = ElementProps & Readonly<{
  lim?: Limit; ticks?: TickSpec; interval?: number; direction?: 'x' | 'y';
}>;
type MeshData = Omit<MeshProps, 'ticks'> & Readonly<{ values: readonly number[]; lim: Limit }>;
type Mesh2DProps = ElementProps & Readonly<{
  xlim?: Limit; ylim?: Limit; xticks?: TickSpec; yticks?: TickSpec;
}>;

function tick_values(ticks: TickSpec = 5, lim: Limit = [0, 1], interval?: number): readonly Tick[] {
  if (typeof ticks === 'number') return linear_ticks(lim, ticks, interval);
  const low = Math.min(...lim), high = Math.max(...lim);
  return ticks.filter(tick => {
    const value = finite(typeof tick === 'number' ? tick : tick[0], 'tick');
    return value >= low && value <= high;
  });
}

function axis_data({ ticks = 5, format = format_tick, ...props }: AxisProps): AxisData {
  const lim = copy_limit(props.lim ?? [0, 1], 'lim');
  const items = tick_values(ticks, lim, props.interval).map((tick, i) => {
    const value = typeof tick === 'number' ? tick : tick[0];
    const content = typeof tick === 'number' ? format(tick, i) : tick[1];
    const text = content instanceof Element ? content : new Text({ text: String(content), ...props.label_style });
    const label = props.rotate ? new Rotate({ angle: props.rotate, children: text }) : text;
    return { value, label };
  });
  return { ...props, lim, items };
}

// Axis allocation is the graph frame. Labels and ticks extend outside it and
// report ordinary overflow, which Plot uses when reserving margins.
function axis_layout(props: AxisData, query: LayoutQuery, mode: 'axis' | 'scale' | 'labels' = 'axis') {
  const size = shape_size(query.request, query.sizing);
  const { side = 'bottom', lim, items } = props;
  if (!['top', 'right', 'bottom', 'left'].includes(side)) throw new TypeError('Unknown axis side');
  const horizontal = side === 'top' || side === 'bottom', positive = side === 'bottom' || side === 'right';
  const coord = query.coordinates ?? infer_coordinates([], horizontal ? { xlim: lim } : { ylim: lim });
  const extent = horizontal ? size.width : size.height;
  const along = (value: number) => map_axis(value, horizontal ? coord.xlim : coord.ylim,
    extent, horizontal ? coord.flip_x : coord.flip_y);
  const cross = props.at === undefined
    ? side === 'bottom' ? size.height : side === 'right' ? size.width : 0
    : map_axis(props.at, horizontal ? coord.ylim : coord.xlim,
      horizontal ? size.height : size.width, horizontal ? coord.flip_y : coord.flip_x);
  const point = (a: number, b: number) => horizontal ? make_point(a, b) : make_point(b, a);
  const basis = { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) };
  const tick_size = nonnegative(resolve_length(props.tick_size ?? px(5), basis, 'tick_size'), 'tick_size');
  const gap = nonnegative(resolve_length(props.label_offset ?? px(4), basis, 'label_offset'), 'label_offset');
  const sign = positive ? 1 : -1;
  const paint = resolve_paint(resolve_style(props.line_style, query.style), size, query.path);
  const draw = mode === 'axis' && (props.line ?? true) ? arrow_draw(
    [point(along(lim[0]), cross), point(along(lim[1]), cross)], paint,
    { ...paint, fill: paint.stroke, stroke: 'none' }, props.arrow ? 7 : 0,
    { end_head: props.arrow }) : [];
  if (mode !== 'labels' && tick_size) {
    const ticks = items.flatMap(item => line_path([
      point(along(item.value), cross), point(along(item.value), cross + sign * tick_size),
    ]));
    const tick_paint = resolve_paint(resolve_style(props.tick_style, query.style), size, query.path);
    draw.push(draw_path(ticks, { ...tick_paint, fill: 'none' }));
  }
  const children = mode !== 'scale' && (props.labels ?? true) ? items.map((item, index) => {
    const fragment = query.child(item.label, make_request(), size, index, { coordinates: null });
    const { width, height } = fragment.size;
    const a = along(item.value), b = cross + sign * (tick_size + gap);
    const offset = horizontal ? make_point(a - width / 2, b - (positive ? 0 : height))
      : make_point(b - (positive ? 0 : width), a - height / 2);
    return place_fragment(fragment, offset);
  }) : [];
  return make_fragment({ size, draw, children });
}

const options = { normalize: axis_data, data_bounds: () => null };
const Axis = define_element<AxisData, AxisProps>('Axis', axis_layout, {}, options);
const HAxis = define_element<AxisData, AxisProps>('HAxis', axis_layout, { side: 'bottom' }, options);
const VAxis = define_element<AxisData, AxisProps>('VAxis', axis_layout, { side: 'left' }, options);
const Scale = define_element<AxisData, AxisProps>('Scale', (p, q) => axis_layout(p, q, 'scale'), {}, options);
const HScale = define_element<AxisData, AxisProps>('HScale', (p, q) => axis_layout(p, q, 'scale'), { side: 'bottom' }, options);
const VScale = define_element<AxisData, AxisProps>('VScale', (p, q) => axis_layout(p, q, 'scale'), { side: 'left' }, options);
const Labels = define_element<AxisData, AxisProps>('Labels', (p, q) => axis_layout(p, q, 'labels'), {}, options);
const HLabels = define_element<AxisData, AxisProps>('HLabels', (p, q) => axis_layout(p, q, 'labels'), { side: 'bottom' }, options);
const VLabels = define_element<AxisData, AxisProps>('VLabels', (p, q) => axis_layout(p, q, 'labels'), { side: 'left' }, options);

const label_options = { data_bounds: () => null,
  normalize: ({ value = 0, label, children, ...props }: LabelProps) => axis_data({ ...props,
    ticks: [[value, label ?? (children === undefined ? format_tick(value)
      : children instanceof Element ? children : new Text({ ...props.label_style, children }))]] }) };
const Label = define_element<AxisData, LabelProps>('Label', (p, q) => axis_layout(p, q, 'labels'), {}, label_options);
const HLabel = define_element<AxisData, LabelProps>('HLabel', (p, q) => axis_layout(p, q, 'labels'), { side: 'bottom' }, label_options);
const VLabel = define_element<AxisData, LabelProps>('VLabel', (p, q) => axis_layout(p, q, 'labels'), { side: 'left' }, label_options);

function mesh_data({ ticks = 5, ...props }: MeshProps): MeshData {
  const lim = copy_limit(props.lim ?? [0, 1]);
  return { ...props, lim, values: tick_values(ticks, lim, props.interval)
    .map(tick => typeof tick === 'number' ? tick : tick[0]) };
}

function mesh_layout(props: MeshData, query: LayoutQuery) {
  const size = shape_size(query.request, query.sizing), vertical = (props.direction ?? 'x') === 'x';
  if (props.direction && !['x', 'y'].includes(props.direction)) throw new TypeError('Unknown mesh direction');
  const coord = query.coordinates ?? infer_coordinates([], vertical ? { xlim: props.lim } : { ylim: props.lim });
  const commands = props.values.flatMap(value => {
    const pos = map_axis(value, vertical ? coord.xlim : coord.ylim, vertical ? size.width : size.height,
      vertical ? coord.flip_x : coord.flip_y);
    return line_path(vertical ? [make_point(pos, 0), make_point(pos, size.height)]
      : [make_point(0, pos), make_point(size.width, pos)]);
  });
  return make_fragment({ size, draw: [draw_path(commands,
    { ...resolve_paint(query.style, size, query.path), fill: 'none' })] });
}
const mesh_options = { normalize: mesh_data, data_bounds: () => null };
const Mesh = define_element<MeshData, MeshProps>('Mesh', mesh_layout, { stroke: '#e2e8f0' }, mesh_options);
const HMesh = define_element<MeshData, MeshProps>('HMesh', mesh_layout,
  { direction: 'x', stroke: '#e2e8f0' }, mesh_options);
const VMesh = define_element<MeshData, MeshProps>('VMesh', mesh_layout,
  { direction: 'y', stroke: '#e2e8f0' }, mesh_options);

const Mesh2D = define_element<ElementProps, Mesh2DProps>('Mesh2D', (props, query) => {
  const size = shape_size(query.request, query.sizing);
  const children = (props.children as readonly Element[]).map((child, i) =>
    place_fragment(query.child(child, query.request, size, i)));
  return make_fragment({ size, children });
}, {}, { data_bounds: () => null, normalize: ({ xlim, ylim, xticks, yticks, ...props }) => ({ ...props,
  children: [new HMesh({ lim: xlim, ticks: xticks, stroke: props.stroke ?? '#e2e8f0' }),
    new VMesh({ lim: ylim, ticks: yticks, stroke: props.stroke ?? '#e2e8f0' })],
}) });

export { Axis, HAxis, VAxis, Scale, HScale, VScale, Label, HLabel, VLabel,
  Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D, tick_values };
export type { Tick, TickSpec, AxisProps, LabelProps, MeshProps, Mesh2DProps };
