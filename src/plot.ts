import { HAxis, VAxis, HMesh, VMesh } from './axis';
import type { AxisProps, TickSpec } from './axis';
import { Bars } from './bars';
import type { BarsProps } from './bars';
import { box_layout } from './box';
import type { BoxProps } from './box';
import { infer_coordinates } from './coordinates';
import type { Coordinates } from './coordinates';
import { text_element } from './document';
import { draw_rect } from './drawing';
import { define_element, Element, element_children } from './element';
import type { ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import type { Fragment, Placement } from './fragment';
import { make_point, make_rect, make_size, resolve_insets } from './geometry';
import type { InsetSpec } from './geometry';
import { graph_size, graph_children } from './graph';
import type { GraphProps } from './graph';
import { available, exact, make_request, shape_size } from './layout';
import { Points } from './marks';
import type { LayoutQuery } from './pass';
import { Rotate } from './placement';
import type { Side } from './placement';
import { Line, Rect } from './shapes';
import { HStack, VStack } from './stack';
import type { StyleSpec } from './style';
import { em, px, resolve_length } from './units';
import type { Length } from './units';

type LegendEntry = Readonly<{
  label: string | Element; color?: string; kind?: 'line' | 'point' | 'bar'; badge?: Element;
}>;
type LegendProps = BoxProps & Readonly<{
  entries?: readonly LegendEntry[]; gap?: Length; badge_width?: Length; label_style?: StyleSpec;
}>;
type PlotProps = GraphProps & Readonly<{
  axis?: boolean; xaxis?: boolean | AxisProps; yaxis?: boolean | AxisProps;
  xticks?: TickSpec; yticks?: TickSpec; grid?: boolean;
  title?: string | Element; xlabel?: string | Element; ylabel?: string | Element;
  legend?: readonly LegendEntry[] | Element;
  margin?: InsetSpec; label_gap?: Length; background?: string; plot_background?: string;
  border_color?: string; border_width?: Length;
  axis_style?: StyleSpec; tick_style?: StyleSpec; label_style?: StyleSpec;
  title_style?: StyleSpec; grid_style?: StyleSpec;
}>;
type PlotData = Omit<PlotProps, 'title' | 'xlabel' | 'ylabel' | 'legend'> & Readonly<{
  coordinates: Coordinates; axes: readonly Element[]; meshes: readonly Element[];
  title_element?: Element; x_label?: Element; y_label?: Element; legend_element?: Element;
}>;
type BarPlotProps = Omit<PlotProps, 'direction'> & BarsProps;
type OuterLabelProps = ElementProps & Readonly<{
  side?: Side; offset?: Length; label?: string | Element; rotate?: number;
}>;
type OuterLabelData = ElementProps & Readonly<{ side?: Side; offset?: Length; label_element: Element }>;

const Legend = define_element<BoxProps, LegendProps>('Legend', box_layout,
  { padding: em(0.6), border_width: px(1), border_color: '#cbd5e1', background: 'white', radius: px(4) }, {
    data_bounds: () => null,
    normalize: ({ entries = [], gap = em(0.4), badge_width = em(1.8), label_style, ...props }) => ({ ...props,
      children: new VStack({ gap, children: entries.map(entry => {
        const color = entry.color ?? '#2563eb';
        const badge = entry.badge ?? (entry.kind === 'bar'
          ? new Rect({ width: badge_width, height: em(0.7), fill: color, stroke: 'none' })
          : entry.kind === 'point' ? new Points({ width: badge_width, height: em(0.8), space: 'local',
            points: [{ x: 0.5, y: 0.5 }], fill: color, point_size: px(7) })
            : new Line({ width: badge_width, height: em(0.8), from: { x: 0, y: 0.5 },
              to: { x: 1, y: 0.5 }, stroke: color, stroke_width: px(2) }));
        return new HStack({ gap: em(0.5), align: 'center', children: [badge, text_element(entry.label, label_style)] });
      }) }),
    }),
  });

// Bounds, tick values, and label descriptions depend only on source data. Build
// them once; every resize reuses these identities and only lays out their geometry.
function plot_data({ title, xlabel, ylabel, legend, ...props }: PlotProps): PlotData {
  const coordinates = infer_coordinates(props.children, { padding: 0.05, ...props });
  const axes: Element[] = [], meshes: Element[] = [];
  const common = { ...props.axis_style, tick_style: props.tick_style, label_style: props.label_style };
  for (const axis of ['x', 'y'] as const) {
    const option = (axis === 'x' ? props.xaxis : props.yaxis) ?? props.axis ?? true;
    const options = typeof option === 'object' ? option : {};
    const lim = axis === 'x' ? coordinates.xlim : coordinates.ylim;
    const ticks = (axis === 'x' ? props.xticks : props.yticks) ?? options.ticks ?? 5;
    const args = { ...common, ...options, lim, ticks };
    if (option) axes.push(axis === 'x' ? new HAxis(args) : new VAxis(args));
    if (props.grid ?? true) {
      const args = { lim, ticks, interval: options.interval, ...props.grid_style };
      meshes.push(axis === 'x' ? new HMesh(args) : new VMesh(args));
    }
  }
  // Callback-bearing axis options have been consumed by Axis constructors.
  const { xaxis, yaxis, ...source } = props;
  return { ...source, coordinates, axes, meshes,
    title_element: title === undefined ? undefined : text_element(title,
      { font_size: em(1.35), font_weight: 700, ...props.title_style }),
    x_label: xlabel === undefined ? undefined : text_element(xlabel, props.label_style),
    y_label: ylabel === undefined ? undefined : new Rotate({ angle: -90,
      children: text_element(ylabel, props.label_style) }),
    legend_element: legend === undefined ? undefined : legend instanceof Element ? legend : new Legend({ entries: legend }),
  };
}

function plot_layout(props: PlotData, query: LayoutQuery): Fragment {
  const size = graph_size(query), { coordinates } = props;
  const basis = { font_size: query.style.font_size, reference: size, path: query.path };
  const margin = resolve_insets(props.margin ?? px(12), basis, 'margin');
  const gap = resolve_length(props.label_gap ?? px(8),
    { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) }, 'label_gap');
  if (gap < 0) throw new RangeError('label_gap must be nonnegative');
  const context = { coordinates };
  const probe = make_request({ width: exact(size.width), height: exact(size.height) });
  const axes = props.axes.map((axis, i) => query.child(axis, probe, size, i, context));
  const extents = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const axis of axes) for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    extents[side] = Math.max(extents[side], axis.overflow[side]);
  }
  const measure = (element: Element | undefined, index: number, width?: number) => element
    ? query.child(element, make_request({ width: width === undefined ? undefined : available(width) }),
      size, index, { coordinates: null }) : undefined;
  const ylabel = measure(props.y_label, 22);
  const left = margin.left + extents.left + (ylabel ? ylabel.size.width + gap : 0);
  const right = margin.right + extents.right;
  const text_width = Math.max(0, size.width - left - right);
  const title = measure(props.title_element, 20, text_width), xlabel = measure(props.x_label, 21, text_width);
  const top = margin.top + extents.top + (title ? title.size.height + gap : 0);
  const bottom = margin.bottom + extents.bottom + (xlabel ? xlabel.size.height + gap : 0);
  const area = make_rect(left, top, Math.max(0, size.width - left - right), Math.max(0, size.height - top - bottom));
  const inner = make_size(area.width, area.height);
  const request = make_request({ width: exact(inner.width), height: exact(inner.height) });
  const offset = make_point(area.x, area.y), children: Placement[] = [];
  const add = (fragment: Fragment) => children.push(place_fragment(fragment, offset));
  const plot_rect = make_rect(0, 0, inner.width, inner.height);
  if (props.plot_background) add(make_fragment({ name: 'PlotBackground', size: inner,
    draw: [draw_rect(plot_rect, { fill: props.plot_background, stroke: 'none', stroke_width: 0,
      opacity: query.style.opacity })] }));
  props.meshes.forEach((mesh, i) => add(query.child(mesh, request, inner, 30 + i, context)));
  const data = make_fragment({ name: 'Graph', size: inner,
    children: graph_children(element_children(props.children), query, inner, coordinates),
    clip: (props.clip ?? true) ? plot_rect : undefined });
  add(data);
  const border = resolve_length(props.border_width ?? px(0),
    { font_size: query.style.font_size, fraction: Math.min(inner.width, inner.height) }, 'border_width');
  if (border < 0) throw new RangeError('border_width must be nonnegative');
  if (border) add(make_fragment({ name: 'PlotBorder', size: inner,
    draw: [draw_rect(plot_rect, { fill: 'none', stroke: props.border_color ?? '#cbd5e1', stroke_width: border,
      opacity: query.style.opacity })] }));
  props.axes.forEach((axis, i) => add(query.child(axis, request, inner, i, context)));
  // Outer text stays upright; only the completed y title is rotated.
  if (title) children.push(place_fragment(title,
    make_point(left + (inner.width - title.size.width) / 2, margin.top)));
  if (xlabel) children.push(place_fragment(xlabel,
    make_point(left + (inner.width - xlabel.size.width) / 2, size.height - margin.bottom - xlabel.size.height)));
  if (ylabel) children.push(place_fragment(ylabel,
    make_point(margin.left, top + (inner.height - ylabel.size.height) / 2)));
  if (props.legend_element) {
    const legend = query.child(props.legend_element,
      make_request({ width: available(inner.width), height: available(inner.height) }), inner, 40, { coordinates: null });
    children.push(place_fragment(legend,
      make_point(area.x + inner.width - legend.size.width - gap, area.y + gap)));
  }
  const draw = props.background ? [draw_rect(make_rect(0, 0, size.width, size.height),
    { fill: props.background, stroke: 'none', stroke_width: 0, opacity: query.style.opacity })] : [];
  return make_fragment({ size, content: area, draw, children });
}

const Plot = define_element<PlotData, PlotProps>('Plot', plot_layout,
  { font_size: px(12), color: '#334155', stroke: '#64748b' }, { normalize: plot_data, data_bounds: () => null });
const BarPlot = define_element<PlotData, BarPlotProps>('BarPlot', plot_layout,
  { font_size: px(12), color: '#334155', stroke: '#64748b' }, { data_bounds: () => null,
    normalize: ({ values, positions, bases, bar_width, styles, direction, radius, children, ...props }) => plot_data({
      ...props, children: [new Bars({ values, positions, bases, bar_width, styles, direction, radius,
        fill: props.fill ?? '#2563eb' }),
        ...element_children(children)],
    }),
  });

const OuterLabel = define_element<OuterLabelData, OuterLabelProps>('OuterLabel', (props, query) => {
  const size = shape_size(query.request, query.sizing), { side = 'bottom' } = props;
  if (!['top', 'right', 'bottom', 'left'].includes(side)) throw new TypeError('Unknown label side');
  const label = query.child(props.label_element, make_request(), size, 0, { coordinates: null });
  const offset = resolve_length(props.offset ?? em(1),
    { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) }, 'offset');
  const x = side === 'left' ? -offset - label.size.width : side === 'right' ? size.width + offset
    : (size.width - label.size.width) / 2;
  const y = side === 'top' ? -offset - label.size.height : side === 'bottom' ? size.height + offset
    : (size.height - label.size.height) / 2;
  return make_fragment({ size, children: [place_fragment(label, make_point(x, y))] });
}, {}, { data_bounds: () => null, normalize: ({ label, children, rotate, ...props }) => {
  const element = text_element(label ?? children);
  return { ...props, label_element: rotate ? new Rotate({ angle: rotate, children: element }) : element };
} });

export { Plot, BarPlot, Legend, OuterLabel };
export type { PlotProps, BarPlotProps, LegendProps, LegendEntry, OuterLabelProps };
