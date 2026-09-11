import { nonnegative } from './checks';
import { define_element, element_children } from './element';
import type { ElementProps } from './element';
import { draw_rect } from './drawing';
import { make_fragment, place_fragment } from './fragment';
import { make_size, make_rect } from './geometry';
import { available, finish_size, make_request, shape_size } from './layout';
import { resolve_length } from './units';
import type { UnitLength } from './units';

type RectProps = ElementProps;
type SvgProps = ElementProps & Readonly<{ width: UnitLength; height: UnitLength }>;

const Rect = define_element<RectProps>('Rect', (props, query) => {
  // Shapes resize their geometry; pixel strokes remain pixel strokes.
  if (element_children(props.children).length) throw new TypeError('Rect has no content children');
  const size = shape_size(query.request, query.sizing);
  const { width, height } = size;
  const { fill, stroke, font_size } = query.style;
  const basis = { font_size, fraction: Math.min(width, height) };
  const stroke_width = nonnegative(resolve_length(
    query.style.stroke_width, basis, `${query.path}.stroke_width`,
  ), 'stroke_width');

  const draw = draw_rect(make_rect(0, 0, width, height), { fill, stroke, stroke_width });
  return make_fragment({ size, draw: [draw] });
});

const Svg = define_element<SvgProps>('Svg', (props, query) => {
  // The viewport is explicit; a tight resize changes layout rather than magnification.
  for (const axis of ['width', 'height'] as const) {
    if (props[axis]?.unit !== 'px') throw new TypeError(`Svg.${axis} requires px()`);
  }
  const size = finish_size(make_size(), query.request, query.sizing);
  const children = element_children(props.children);
  if (children.length > 1) throw new TypeError('Svg accepts one content element');

  // The viewport establishes the reference even though the child gets a soft offer.
  const request = make_request({ width: available(size.width), height: available(size.height) });
  const content = children.map((child, index) =>
    place_fragment(query.child(child, request, size, index)));
  const clip = make_rect(0, 0, size.width, size.height);
  return make_fragment({ size, children: content, clip });
});

export { Rect, Svg };
export type { RectProps, SvgProps };
