export { DEFAULTS } from './engine/defaults'
export { THEMES, resolve_theme, theme_color } from './engine/theme'
export type { ThemeName, ThemePalette } from './engine/theme'
export {
  sans, mono, light, regular, bold,
  none, black, white, gray, blue, red, green, yellow, purple, lightgray, darkgray, slate,
  e, pi, tau, phi, r2d, d2r,
} from './lib/constants'
export * from './lib/math'
export * from './lib/arrays'
export * from './lib/vectors'
export * from './lib/random'
export { interp, palette } from './lib/colors'
export {
  em, px, normalize_length, measure_length, resolve_length,
  resolve_font_size, resolve_line_height, UnresolvedLengthError,
} from './engine/units'
export type {
  UnitLength, Length, NormalizedLength, LengthBasis, ReferenceBox, LengthContext,
} from './engine/units'
export {
  make_size, make_point, make_rect, make_clip, make_insets, add_insets, resolve_insets,
  deflate_size, inflate_size, bounds_overflow,
} from './engine/geometry'
export type { Point, PointValue, Size, Rect as PixelRect, CornerRadii, RectRadii, RectRadiiValue,
  Clip as ClipShape, Insets, InsetSpec } from './engine/geometry'
export {
  natural, available, exact, make_request, deflate_request,
  resolve_sizing, prepare_request, finish_size, shape_size,
} from './engine/layout'
export type {
  AxisRequest, LayoutRequest, SizeMode, SizeSpec, AxisSizing, Sizing,
} from './engine/layout'
export { union_rects, intersect_rects, make_transform, transform_rect } from './engine/geometry'
export { make_fragment, place_fragment, content_bounds, transform_guides } from './engine/fragment'
export type { Transform, Guides, Connection, Fragment, Placement, FragmentSpec } from './engine/fragment'
export { draw_rect, draw_ellipse, draw_path, draw_image, drawing_ink } from './engine/drawing'
export type { Paint, Drawing, RectDraw, EllipseDraw, PathDraw, ImageDraw } from './engine/drawing'
export { move_to, line_to, quad_to, curve_to, close_path, transform_path } from './engine/path'
export type { PathCommand, PathSegment } from './engine/path'
export { resolve_style, resolve_paint } from './engine/style'
export type { Style, StyleSpec, FontStyle, LineCap, LineJoin } from './engine/style'
export { Fonts, FontNotLoadedError, MissingGlyphError } from './engine/fonts'
export type { FontProvider, MeasuredFont, GlyphShape, FontOptions, FontData } from './engine/fonts'
export { Element, define_element, define_component, element_children, content_child } from './engine/element'
export type { Child, ElementProps, ElementType, LayoutMethod, ElementOptions } from './engine/element'
export { prefix_split, prefix_join } from './lib/props'
export type { Prefixed } from './lib/props'
export { LayoutPass, LayoutError } from './engine/pass'
export type { LayoutQuery, LayoutContext, Resource } from './engine/pass'
export { copy_math_context, copy_math_metrics } from './engine/math'
export type { MathSizeStyle, MathStyle, MathClass, MathContext, MathMetrics } from './engine/math'
export { Svg } from './elems/svg'
export type { SvgProps } from './elems/svg'
export { PngImage } from './elems/image'
export type { PngImageProps } from './elems/image'
export { png_size } from './lib/png'
export { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path } from './elems/shapes'
export { UnitLine, HLine, VLine, Dot, Triangle } from './elems/shapes'
export type { Position, PositionValue, Radius, RadiusSides, RectRadius, RectProps, CircleProps, EllipseProps,
  LineProps, PolylineProps, PolygonProps, PathProps } from './elems/shapes'
export { Text, Span } from './elems/text'
export type { TextProps, TextOptions, SpanProps } from './elems/text'
export { Box, Frame, Fit } from './elems/box'
export type { BoxProps, FitProps } from './elems/box'
export { HStack, VStack, Spacer } from './elems/stack'
export type { StackProps, StackAlign, StackJustify } from './elems/stack'
export { Group } from './elems/group'
export type { GroupProps, PositionSpec, AnchorValue } from './elems/group'
export { distribute_flex } from './lib/flex'
export type { FlexSpec, FlexItem } from './lib/flex'
export { resolve_alignment, align_offset, definite_reference, layout_content, fit_scale } from './lib/composition'
export type { AlignmentValue, Alignment, ResolvedAlignment, FitMode } from './lib/composition'
export { render_svg } from './svg'
export type { SvgOptions } from './svg'
export { make_viewport, layout_element, render_element } from './render'
export type {
  ViewportOptions, LayoutElementOptions, RenderElementOptions, LayoutElementResult, RenderElementResult,
} from './render'
export { inspect_fragment } from './inspect'
export { evaluate } from './eval'
export type { EvaluateOptions } from './eval'
export { Graph } from './elems/graph'
export type { GraphProps } from './elems/graph'
export { Node, Edge, Network } from './elems/network'
export type { NodeProps, EdgeProps, NetworkProps } from './elems/network'
export { copy_limit, copy_coordinates, point_bounds, merge_bounds, data_bounds,
  infer_coordinates, map_axis, map_point, unmap_point, coordinate_length } from './engine/coordinates'
export type { Limit, DataBounds, Coordinates, CoordinateSpec, GeometrySpace } from './engine/coordinates'
export { Overlay, TransformBox, Rotate, Attach } from './elems/placement'
export type { Side, OverlayProps, TransformBoxProps, RotateProps, AttachProps, AnchorProps } from './elems/placement'
export { CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill,
  Arrow, ArrowHead, Ray, Points } from './elems/marks'
export type { MarkProps, CoordLineProps, SplineProps, RoundedLineProps, SegmentsProps,
  ArcProps, FillProps, ArrowProps, ArrowBarbSide, ArrowHeadOptions, ArrowHeadStyle, ArrowHeadProps, RayProps, PointSize, PointsProps } from './elems/marks'
export { spline_path, rounded_path, arc_path, spline1d, spline2d } from './lib/curves'
export { arrow_barb } from './lib/arrows'
export { Bar, VBar, HBar, Bars, VBars, HBars } from './elems/bars'
export type { PerBar, BarStyle, BarProps, BarsProps } from './elems/bars'
export { HAxis, VAxis, Scale, HScale, VScale, Label, HLabel, VLabel,
  Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D } from './elems/axis'
export type { Tick, TickSpec, TickSide, AxisProps, LabelProps, MeshProps, Mesh2DProps } from './elems/axis'
export { Plot, BarPlot, Legend, OuterLabel } from './elems/plot'
export type { PlotProps, BarPlotProps, LegendProps, LegendEntry, OuterLabelProps } from './elems/plot'
export { linear_ticks, format_tick } from './lib/ticks'
export { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide } from './elems/document'
export type { TextStackProps, TextBoxProps, TextFigureProps, TitleBoxProps, TitleFrameProps, TitleFrameTitleStyle, BulletsProps, SlideProps } from './elems/document'
export { sample_curve, sample_points } from './lib/sampling'
export type { ScalarFunction, SampleProps, Sample } from './lib/sampling'
export { SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField } from './elems/symbolic'
export type { SymLineProps, SymSplineProps, SymPointsProps, SymFillProps,
  VectorSample, VectorSampleValue, FieldProps, SymFieldProps } from './elems/symbolic'
import { Axis as AxisElement } from './elems/axis'
import { Anchor as AnchorElement } from './elems/placement'
import type { Axis as LayoutAxis } from './engine/layout'
import type { Anchor as AnchorSpec } from './elems/group'

// Preserve the existing metadata type names alongside the new element values.
export const Axis = AxisElement
export const Anchor = AnchorElement
export type Axis = LayoutAxis
export type Anchor = AnchorSpec
export type { LayoutAxis, AnchorSpec }
