// The existing parser depends only on Acorn and source-error helpers, not layout.
import { runJSX } from '../lib/parse';
import { Element, define_element, element_children } from './element';
import { Svg } from './elems';
import { Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path } from './shapes';
import { Box, Frame, Fit } from './box';
import { HStack, VStack, Spacer } from './stack';
import { Text, Span } from './text';
import { move_to, line_to, quad_to, curve_to, close_path } from './path';
import { em, px } from './units';
import { available, exact, natural, make_request, finish_size, shape_size } from './layout';
import { make_size, make_point, make_rect } from './geometry';
import { make_fragment, place_fragment } from './fragment';
import { draw_rect } from './drawing';

type EvaluateOptions = Readonly<{ scope?: Readonly<Record<string, unknown>>; name?: string }>;

// Evaluation constructs descriptions only. Component functions can return other elements.
function evaluate(code: string, options: EvaluateOptions = {}): Element {
  const { scope = {}, name = 'gum-next.jsx' } = options;
  const bindings = {
    Svg, Box, Frame, Fit, HStack, VStack, Spacer, Rect, RoundedRect, Square, Circle, Ellipse,
    Line, Polyline, Polygon, Path, Text, Span,
    move_to, line_to, quad_to, curve_to, close_path,
    em, px, define_element, element_children,
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
