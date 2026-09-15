// The existing parser depends only on Acorn and source-error helpers, not layout.
import { runJSX } from './lib/parse'
import { Element, define_element, define_component, element_children } from './engine/element'
import { prefix_split, prefix_join } from './lib/props'
import { Svg } from './elems/svg'
import { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path } from './elems/shapes'
import { UnitLine, HLine, VLine, Dot, Triangle } from './elems/shapes'
import { Box, Frame, Fit } from './elems/box'
import { HStack, VStack, Spacer } from './elems/stack'
import { Group } from './elems/group'
import { Text, Span } from './elems/text'
import { move_to, line_to, quad_to, curve_to, close_path } from './engine/path'
import { em, px } from './engine/units'
import { available, exact, natural, make_request, finish_size, shape_size } from './engine/layout'
import { make_size, make_point, make_rect } from './engine/geometry'
import { make_fragment, place_fragment } from './engine/fragment'
import { draw_rect } from './engine/drawing'
import { THEMES, theme_color } from './engine/theme'
import * as constants from './lib/constants'
import * as math from './lib/math'
import * as arrays from './lib/arrays'
import * as vectors from './lib/vectors'
import { interp, palette } from './lib/colors'
import { RNG } from './lib/random'
import { Graph } from './elems/graph'
import { Node, Edge, Network } from './elems/network'
import { Overlay, TransformBox, Rotate, Attach, Anchor } from './elems/placement'
import { CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill, Arrow, ArrowHead, Ray, Points } from './elems/marks'
import { Bar, VBar, HBar, Bars, VBars, HBars } from './elems/bars'
import { Axis, HAxis, VAxis, Scale, HScale, VScale, Label, HLabel, VLabel,
  Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D } from './elems/axis'
import { Plot, BarPlot, Legend, OuterLabel } from './elems/plot'
import { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide } from './elems/document'
import { SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField } from './elems/symbolic'
import { sample_curve, sample_points } from './lib/sampling'
import { linear_ticks, format_tick } from './lib/ticks'
import { spline1d, spline2d } from './lib/curves'
import { infer_coordinates, data_bounds, point_bounds, merge_bounds, map_point, unmap_point } from './engine/coordinates'

type EvaluateOptions = Readonly<{ scope?: Readonly<Record<string, unknown>>; name?: string; seed?: number }>

// Evaluation constructs descriptions only. Component functions can return other elements.
function evaluate(code: string, options: EvaluateOptions = {}): Element {
  const { scope = {}, name = 'gum-next.jsx', seed } = options
  const rng = new RNG(seed)
  const bindings = {
    ...constants, ...math, ...arrays, ...vectors, interp, palette, RNG, THEMES, theme_color,
    setSeed: (seed: number) => { rng.setSeed(seed); },
    random: rng.random, uniform: rng.uniform, normal: rng.normal, integer: rng.integer,
    Svg, Box, Frame, Fit, HStack, VStack, Spacer, Group, Rect, RoundedRect, Square, Circle, Ellipse,
    Line, Polyline, Polygon, Path, Text, Span,
    UnitLine, HLine, VLine, Dot, Triangle,
    Graph, Plot, BarPlot, Legend, OuterLabel, Overlay, TransformBox, Rotate, Attach, Anchor, Node, Edge, Network,
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
  }
  const result = runJSX(code, bindings, false, name)
  if (!(result instanceof Element)) throw new TypeError('JSX must return one next Element')
  return result
}

export { evaluate }
export type { EvaluateOptions }
