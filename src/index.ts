export { DEFAULTS } from './defaults';
export {
  sans, mono, light, regular, bold,
  none, black, white, gray, blue, red, green, yellow, purple, lightgray, darkgray, slate,
  e, pi, phi, r2d, d2r,
} from './constants';
export {
  em, px, normalize_length, measure_length, resolve_length,
  resolve_font_size, resolve_line_height, UnresolvedLengthError,
} from './units';
export type {
  UnitLength, Length, NormalizedLength, LengthBasis, ReferenceBox, LengthContext,
} from './units';
export {
  make_size, make_point, make_rect, make_clip, make_insets, add_insets, resolve_insets,
  deflate_size, inflate_size, bounds_overflow,
} from './geometry';
export type { Point, Size, Rect as PixelRect, Clip as ClipShape, Insets, InsetSpec } from './geometry';
export {
  natural, available, exact, make_request, deflate_request,
  resolve_sizing, prepare_request, finish_size, shape_size,
} from './layout';
export type {
  AxisRequest, LayoutRequest, SizeSpec, AxisSizing, Sizing,
} from './layout';
export { union_rects, intersect_rects, make_transform, transform_rect } from './geometry';
export { make_fragment, place_fragment, content_bounds, transform_guides } from './fragment';
export type { Transform, Guides, Fragment, Placement, FragmentSpec } from './fragment';
export { draw_rect, draw_ellipse, draw_path, drawing_ink } from './drawing';
export type { Paint, Drawing, RectDraw, EllipseDraw, PathDraw } from './drawing';
export { move_to, line_to, quad_to, curve_to, close_path } from './path';
export type { PathCommand, PathSegment } from './path';
export { resolve_style, resolve_paint } from './style';
export type { Style, StyleSpec, FontStyle, LineCap, LineJoin } from './style';
export { Fonts } from './fonts';
export type { FontProvider, MeasuredFont, GlyphShape, FontOptions, FontData } from './fonts';
export { Element, define_element, define_component, element_children, content_child } from './element';
export type { Child, ElementProps, ElementType, LayoutMethod, ElementOptions } from './element';
export { LayoutPass, LayoutError } from './pass';
export type { LayoutQuery, LayoutContext, Resource } from './pass';
export { Svg } from './elems';
export type { SvgProps } from './elems';
export { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path } from './shapes';
export { UnitLine, HLine, VLine, Dot, Triangle } from './shapes';
export type { Position, Radius, RectProps, CircleProps, EllipseProps,
  LineProps, PolylineProps, PolygonProps, PathProps } from './shapes';
export { Text, Span } from './text';
export type { TextProps, SpanProps } from './text';
export { Box, Frame, Fit } from './box';
export type { BoxProps, FitProps } from './box';
export { HStack, VStack, Spacer } from './stack';
export type { StackProps, StackAlign, StackJustify } from './stack';
export { Group } from './group';
export type { GroupProps, PositionSpec, AnchorValue } from './group';
export { distribute_flex } from './flex';
export type { FlexSpec, FlexItem } from './flex';
export { resolve_alignment, align_offset, definite_reference, layout_content, fit_scale } from './composition';
export type { AlignmentValue, Alignment, ResolvedAlignment, FitMode } from './composition';
export { render_svg } from './svg';
export type { SvgOptions } from './svg';
export { inspect_fragment } from './inspect';
export { evaluate } from './eval';
export type { EvaluateOptions } from './eval';
export { Graph } from './graph';
export type { GraphProps } from './graph';
export { copy_limit, copy_coordinates, point_bounds, merge_bounds, data_bounds,
  infer_coordinates, map_axis, map_point, unmap_point, coordinate_length } from './coordinates';
export type { Limit, DataBounds, Coordinates, CoordinateSpec, GeometrySpace } from './coordinates';
export { Overlay, TransformBox, Rotate, Attach } from './placement';
export type { Side, OverlayProps, TransformBoxProps, RotateProps, AttachProps, AnchorProps } from './placement';
export { CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill,
  Arrow, ArrowHead, Ray, Points } from './marks';
export type { MarkProps, CoordLineProps, SplineProps, RoundedLineProps, SegmentsProps,
  ArcProps, FillProps, ArrowProps, ArrowHeadProps, RayProps, PointSize, PointsProps } from './marks';
export { spline_path, rounded_path, arc_path, spline1d, spline2d } from './curves';
export { Bar, VBar, HBar, Bars, VBars, HBars } from './bars';
export type { PerBar, BarProps, BarsProps } from './bars';
export { HAxis, VAxis, Scale, HScale, VScale, Label, HLabel, VLabel,
  Labels, HLabels, VLabels, Mesh, HMesh, VMesh, Mesh2D } from './axis';
export type { Tick, TickSpec, AxisProps, LabelProps, MeshProps, Mesh2DProps } from './axis';
export { Plot, BarPlot, Legend, OuterLabel } from './plot';
export type { PlotProps, BarPlotProps, LegendProps, LegendEntry, OuterLabelProps } from './plot';
export { linear_ticks, format_tick } from './ticks';
export { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide } from './document';
export type { TextStackProps, TextBoxProps, TextFigureProps, TitleBoxProps, BulletsProps, SlideProps } from './document';
export { linspace, sample_curve, sample_points } from './sampling';
export type { PointValue, ScalarFunction, SampleProps, Sample } from './sampling';
export { SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField } from './symbolic';
export type { SymLineProps, SymSplineProps, SymPointsProps, SymFillProps,
  VectorSample, FieldProps, SymFieldProps } from './symbolic';
import { Axis as AxisElement } from './axis';
import { Anchor as AnchorElement } from './placement';
import type { Axis as LayoutAxis } from './layout';
import type { Anchor as AnchorSpec } from './group';

// Preserve the existing metadata type names alongside the new element values.
export const Axis = AxisElement;
export const Anchor = AnchorElement;
export type Axis = LayoutAxis;
export type Anchor = AnchorSpec;
export type { LayoutAxis, AnchorSpec };
