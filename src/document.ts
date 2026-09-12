import { Box, box_layout } from './box';
import type { BoxProps } from './box';
import { define_element, Element, element_children } from './element';
import type { Child, ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point, make_rect, resolve_insets, deflate_size } from './geometry';
import type { InsetSpec } from './geometry';
import { graph_size } from './graph';
import { exact, make_request } from './layout';
import { HStack, VStack, stack_layout } from './stack';
import type { StackProps } from './stack';
import type { StyleSpec } from './style';
import { Text, Span } from './text';
import { em, px } from './units';
import type { Length } from './units';
import { draw_rect } from './drawing';

type TextStackProps = StackProps & Readonly<{ direction?: 'horizontal' | 'vertical' }>;
type TextBoxProps = BoxProps & Readonly<{ text?: string }>;
type TextFigureProps = BoxProps & Readonly<{
  caption?: string | Element; caption_style?: StyleSpec; gap?: Length;
}>;
type TitleBoxProps = BoxProps & Readonly<{ title?: string | Element; title_style?: StyleSpec; gap?: Length }>;
type SlideProps = ElementProps & Readonly<{
  title?: string | Element; title_style?: StyleSpec; padding?: InsetSpec;
  gap?: Length; background?: string; clip?: boolean;
}>;
type SlideData = SlideProps & Readonly<{ body: Element }>;
type BulletsProps = ElementProps & Readonly<{
  items?: readonly Child[]; marker?: string; gap?: Length; indent?: Length;
}>;

// Text composition converts text at construction, so reflow always sees the same
// source elements. Existing figures and their parent-owned flex metadata survive.
function text_element(value: Child, style: StyleSpec = {}): Element {
  return value instanceof Element && !(value instanceof Span)
    ? value : new Text({ ...style, children: value });
}

function text_children(value: Child = []): readonly Element[] {
  const values: readonly Child[] = Array.isArray(value) ? value : [value];
  return values.flatMap(item => item == null || typeof item === 'boolean' ? []
    : Array.isArray(item) ? text_children(item) : [text_element(item)]);
}

const stack_options = { normalize: (props: TextStackProps) => ({ ...props, children: text_children(props.children) }) };
const TextStack = define_element<TextStackProps>('TextStack', (props, query) => {
  if (props.direction && !['horizontal', 'vertical'].includes(props.direction)) throw new TypeError('Unknown text stack direction');
  return stack_layout(props, query, props.direction === 'horizontal' ? 'width' : 'height');
}, { gap: em(0.6) }, stack_options);
const TextRow = define_element<TextStackProps>('TextRow', (p, q) => stack_layout(p, q, 'width'),
  { gap: em(0.6), align: 'baseline' }, stack_options);
const TextCol = define_element<TextStackProps>('TextCol', (p, q) => stack_layout(p, q, 'height'),
  { gap: em(0.6), align: 'stretch' }, stack_options);
const text_box = { normalize: ({ text, ...props }: TextBoxProps) => ({ ...props,
  children: text !== undefined ? new Text({ text }) : text_element(props.children) }) };
const TextBox = define_element<BoxProps, TextBoxProps>('TextBox', box_layout, { padding: em(0.6) }, text_box);
const TextFrame = define_element<BoxProps, TextBoxProps>('TextFrame', box_layout,
  { padding: em(0.6), border_width: px(1) }, text_box);

const TextFigure = define_element<BoxProps, TextFigureProps>('TextFigure', box_layout, {}, {
  normalize: ({ caption, caption_style, gap = em(0.5), children, ...props }) => ({ ...props,
    children: new VStack({ gap, align: 'stretch', children: [
      ...element_children(children), caption === undefined ? null : text_element(caption, caption_style),
    ] }),
  }),
});

const title_options = {
  normalize: ({ title, title_style, gap = em(0.6), children, ...props }: TitleBoxProps) => ({ ...props,
    children: new VStack({ gap, align: 'stretch', children: [
      title === undefined ? null : text_element(title, { font_weight: 700, ...title_style }),
      ...text_children(children),
    ] }),
  }),
};
const TitleBox = define_element<BoxProps, TitleBoxProps>('TitleBox', box_layout, { padding: em(0.75) }, title_options);
const TitleFrame = define_element<BoxProps, TitleBoxProps>('TitleFrame', box_layout,
  { padding: em(0.75), border_width: px(1) }, title_options);

const Bullets = define_element<StackProps, BulletsProps>('Bullets', (p, q) => stack_layout(p, q, 'height'),
  { gap: em(0.5), align: 'stretch' }, {
    normalize: ({ items, marker = '•', indent = em(1.2), children, ...props }) => ({ ...props,
      children: (items ?? (Array.isArray(children) ? children : [children])).map(item => new HStack({
        align: 'baseline', children: [new Text({ text: marker, width: indent }),
          new Box({ grow: 1, shrink: 1, basis: px(0), children: text_element(item) })],
      })),
    }),
  });

// Slides are ordinary fixed canvases with a measured title and flexible content
// region. Text uses pixels/em; resizing never silently magnifies the type scale.
const Slide = define_element<SlideData, SlideProps>('Slide', (props, query) => {
  const size = graph_size(query, 16 / 9);
  const padding = resolve_insets(props.padding ?? em(1.5),
    { font_size: query.style.font_size, reference: size, path: query.path });
  const inner = deflate_size(size, padding);
  const fragment = query.child(props.body, make_request({ width: exact(inner.width), height: exact(inner.height) }), inner);
  const area = make_rect(0, 0, size.width, size.height);
  return make_fragment({ size, content: make_rect(padding.left, padding.top, inner.width, inner.height),
    draw: [draw_rect(area, { fill: props.background ?? 'white', stroke: 'none', stroke_width: 0,
      opacity: query.style.opacity })],
    children: [place_fragment(fragment, make_point(padding.left, padding.top))],
    clip: props.clip ? area : undefined });
}, { font_size: px(20), aspect: 16 / 9 }, {
  data_bounds: () => null,
  normalize: ({ title, title_style, gap = em(0.8), children, ...props }) => ({ ...props,
    body: new VStack({ gap, align: 'stretch', children: [
      title === undefined ? null : text_element(title, { font_size: em(1.6), font_weight: 700, ...title_style }),
      new Box({ grow: 1, shrink: 1, basis: px(0), align: 'stretch', children:
        new TextCol({ children }) }),
    ] }),
  }),
});

export { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide,
  text_element, text_children };
export type { TextStackProps, TextBoxProps, TextFigureProps, TitleBoxProps, BulletsProps, SlideProps };
