import { finite, nonnegative } from './checks';
import { copy_limit, infer_coordinates, map_axis } from './coordinates';
import type { Limit } from './coordinates';
import { draw_path } from './drawing';
import { Element } from './element';
import type { ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point } from './geometry';
import { make_request, shape_size } from './layout';
import { arrow_draw, line_path } from './marks';
import { Rotate } from './placement';
import type { Side } from './placement';
import { scope_props, merge_scoped } from './props';
import type { Prefixed } from './props';
import { resolve_style, resolve_paint } from './style';
import type { StyleSpec } from './style';
import { Text } from './text';
import type { TextOptions } from './text';
import { linear_ticks, format_tick } from './ticks';
import { px, resolve_length } from './units';
import type { Length } from './units';
import type { LayoutQuery } from './pass';

type Tick = number | readonly [number, string | number | Element];
type TickSpec = number | readonly Tick[];
type AxisOptions = ElementProps & Readonly<{
  lim?: Limit; ticks?: TickSpec; interval?: number; side?: Side; at?: number;
  tick_size?: Length; label_offset?: Length; rotate?: number;
  labels?: boolean; line?: boolean; arrow?: boolean;
  format?: (value: number, index: number) => string;
  line_style?: StyleSpec; tick_style?: StyleSpec; label_style?: TextOptions;
}>;
type AxisProps = AxisOptions & Prefixed<'line' | 'tick', StyleSpec> & Prefixed<'label', TextOptions>;
type AxisItem = Readonly<{ value: number; label: Element }>;
type AxisData = Omit<AxisOptions, 'ticks' | 'format'> & Readonly<{ items: readonly AxisItem[]; lim: Limit }>;
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

function axis_props<Props extends AxisProps>(props: Props): Props {
  return scope_props(props, ['line', 'tick', 'label'], ['line_height', 'tick_size', 'label_offset']);
}

// Normalize each specificity level before merging so flat and nested spellings
// obey the same precedence, retaining unrelated fields of shared part options.
function merge_axis_props(...layers: readonly (AxisProps | undefined)[]): AxisOptions {
  return merge_scoped(layers, ['line', 'tick', 'label'], ['line_height', 'tick_size', 'label_offset']);
}

function axis_data(input: AxisProps): AxisData {
  const { ticks = 5, format = format_tick, ...props } = axis_props(input);
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

class Axis extends Element<AxisData, AxisProps> {
  static normalize = axis_data;
  static data_bounds() { return null; }
  static layout = axis_layout;
}

class HAxis extends Axis {
  static defaults: Partial<AxisData> = { side: 'bottom' };
}

class VAxis extends Axis {
  static defaults: Partial<AxisData> = { side: 'left' };
}

class Scale extends Axis {
  static layout(props: AxisData, query: LayoutQuery) {
    return axis_layout(props, query, 'scale');
  }
}

class HScale extends Scale {
  static defaults: Partial<AxisData> = { side: 'bottom' };
}

class VScale extends Scale {
  static defaults: Partial<AxisData> = { side: 'left' };
}

class Labels extends Axis {
  static layout(props: AxisData, query: LayoutQuery) {
    return axis_layout(props, query, 'labels');
  }
}

class HLabels extends Labels {
  static defaults: Partial<AxisData> = { side: 'bottom' };
}

class VLabels extends Labels {
  static defaults: Partial<AxisData> = { side: 'left' };
}

class Label extends Element<AxisData, LabelProps> {
  static data_bounds = Axis.data_bounds;
  static normalize(input: LabelProps): AxisData {
    const { value = 0, label, children, ...props } = axis_props(input);
    return axis_data({ ...props,
      ticks: [[value, label ?? (children === undefined ? format_tick(value)
        : children instanceof Element ? children : new Text({ ...props.label_style, children }))]],
    });
  }
  static layout = Labels.layout;
}

class HLabel extends Label {
  static defaults: Partial<AxisData> = { side: 'bottom' };
}

class VLabel extends Label {
  static defaults: Partial<AxisData> = { side: 'left' };
}

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

class Mesh extends Element<MeshData, MeshProps> {
  static defaults: Partial<MeshData> = { stroke: '#e2e8f0' };
  static normalize = mesh_data;
  static data_bounds = Axis.data_bounds;
  static layout = mesh_layout;
}

class HMesh extends Mesh {
  static defaults: Partial<MeshData> = { direction: 'x' };
}

class VMesh extends Mesh {
  static defaults: Partial<MeshData> = { direction: 'y' };
}

class Mesh2D extends Element<ElementProps, Mesh2DProps> {
  static data_bounds() {
    return null;
  }
  static normalize({ xlim, ylim, xticks, yticks, ...props }: Mesh2DProps): ElementProps {
    return { ...props,
      children: [new HMesh({ lim: xlim, ticks: xticks, stroke: props.stroke ?? '#e2e8f0' }),
        new VMesh({ lim: ylim, ticks: yticks, stroke: props.stroke ?? '#e2e8f0' })],
    };
  }
  static layout(props: ElementProps, query: LayoutQuery) {
    const size = shape_size(query.request, query.sizing);
    const children = (props.children as readonly Element[]).map((child, i) =>
      place_fragment(query.child(child, query.request, size, i)));
    return make_fragment({ size, children });
  }
}

export { Axis, HAxis, VAxis, Scale, HScale, VScale, Label, HLabel, VLabel,
  Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D, tick_values, merge_axis_props };
export type { Tick, TickSpec, AxisProps, LabelProps, MeshProps, Mesh2DProps };
