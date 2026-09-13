// The existing parser depends only on Acorn and source-error helpers, not layout.
import { runJSX } from './lib/parse';
import { Element, define_element, define_component, element_children } from './element';
import { prefix_split, prefix_join } from './props';
import { Svg } from './elems';
import { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path } from './shapes';
import { UnitLine, HLine, VLine, Dot, Triangle } from './shapes';
import { Box, Frame, Fit } from './box';
import { HStack, VStack, Spacer } from './stack';
import { Group } from './group';
import { Text, Span } from './text';
import { move_to, line_to, quad_to, curve_to, close_path } from './path';
import { em, px } from './units';
import { available, exact, natural, make_request, finish_size, shape_size } from './layout';
import { make_size, make_point, make_rect } from './geometry';
import { make_fragment, place_fragment } from './fragment';
import { draw_rect } from './drawing';
import * as constants from './constants';
import * as math from './math';
import * as arrays from './arrays';
import * as vectors from './vectors';
import { interp, palette } from './colors';
import { RNG } from './random';
import { Graph } from './graph';
import { Overlay, TransformBox, Rotate, Attach, Anchor } from './placement';
import { CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill, Arrow, ArrowHead, Ray, Points } from './marks';
import { Bar, VBar, HBar, Bars, VBars, HBars } from './bars';
import { Axis, HAxis, VAxis, Scale, HScale, VScale, Label, HLabel, VLabel,
  Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D } from './axis';
import { Plot, BarPlot, Legend, OuterLabel } from './plot';
import { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide } from './document';
import { SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField } from './symbolic';
import { sample_curve, sample_points } from './sampling';
import { linear_ticks, format_tick } from './ticks';
import { spline1d, spline2d } from './curves';
import { infer_coordinates, data_bounds, point_bounds, merge_bounds, map_point, unmap_point } from './coordinates';

type EvaluateOptions = Readonly<{ scope?: Readonly<Record<string, unknown>>; name?: string; seed?: number }>;

// Evaluation constructs descriptions only. Component functions can return other elements.
function evaluate(code: string, options: EvaluateOptions = {}): Element {
  const { scope = {}, name = 'gum-next.jsx', seed } = options;
  const rng = new RNG(seed);
  const bindings = {
    ...constants, ...math, ...arrays, ...vectors, interp, palette, RNG,
    setSeed: (seed: number) => { rng.setSeed(seed); },
    random: rng.random, uniform: rng.uniform, normal: rng.normal, integer: rng.integer,
    Svg, Box, Frame, Fit, HStack, VStack, Spacer, Group, Rect, RoundedRect, Square, Circle, Ellipse,
    Line, Polyline, Polygon, Path, Text, Span,
    UnitLine, HLine, VLine, Dot, Triangle,
    Graph, Plot, BarPlot, Legend, OuterLabel, Overlay, TransformBox, Rotate, Attach, Anchor,
    CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill, Arrow, ArrowHead, Ray, Points,
    Bar, VBar, HBar, Bars, VBars, HBars, Axis, HAxis, VAxis, Scale, HScale, VScale,
    Label, HLabel, VLabel, Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D,
    TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide,
    SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField,
    sample_curve, sample_points, linear_ticks, format_tick, spline1d, spline2d,
    move_to, line_to, quad_to, curve_to, close_path,
    em, px, Element, define_element, define_component, element_children, prefix_split, prefix_join,
    infer_coordinates, data_bounds, point_bounds, merge_bounds, map_point, unmap_point,
    available, exact, natural, make_request, finish_size, shape_size,
    make_size, make_point, make_rect, make_fragment, place_fragment, draw_rect,
    ...scope,
  };
  const result = runJSX(code, bindings, false, name);
  if (!(result instanceof Element)) throw new TypeError('JSX must return one next Element');
  return result;
}

export { evaluate };
export type { EvaluateOptions };
