import type { LayoutQuery } from './pass';
import { Box, box_layout } from './box';
import type { BoxProps } from './box';
import { Element, element_children } from './element';
import type { Child, ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point, make_rect, resolve_insets, deflate_size } from './geometry';
import type { InsetSpec } from './geometry';
import { graph_size } from './graph';
import { exact, make_request } from './layout';
import { HStack, VStack, stack_layout } from './stack';
import type { StackProps } from './stack';
import { scope_props } from './props';
import type { Prefixed } from './props';
import { Text, Span } from './text';
import type { TextOptions } from './text';
import { em, px } from './units';
import type { Length } from './units';
import { draw_rect } from './drawing';

type TextStackProps = StackProps & Readonly<{ direction?: 'horizontal' | 'vertical' }>;
type TextBoxProps = BoxProps & Readonly<{ text?: string }>;
type TextFigureProps = BoxProps & Prefixed<'caption', TextOptions> & Readonly<{
  caption?: string | Element; caption_style?: TextOptions; gap?: Length;
}>;
type TitleBoxProps = BoxProps & Prefixed<'title', TextOptions>
  & Readonly<{ title?: string | Element; title_style?: TextOptions; gap?: Length }>;
type SlideProps = ElementProps & Prefixed<'title', TextOptions> & Readonly<{
  title?: string | Element; title_style?: TextOptions; padding?: InsetSpec;
  gap?: Length; background?: string; clip?: boolean;
}>;
type SlideData = SlideProps & Readonly<{ body: Element }>;
type BulletsProps = ElementProps & Readonly<{
  items?: readonly Child[]; marker?: string; gap?: Length; indent?: Length;
}>;

// Text composition converts text at construction, so reflow always sees the same
// source elements. Existing figures and their parent-owned flex metadata survive.
function text_element(value: Child, style: TextOptions = {}): Element {
  return value instanceof Element && !(value instanceof Span)
    ? value : new Text({ ...style, children: value });
}

function text_children(value: Child = []): readonly Element[] {
  const values: readonly Child[] = Array.isArray(value) ? value : [value];
  return values.flatMap(item => item == null || typeof item === 'boolean' ? []
    : typeof item === 'string' && /^[ \t\r\n]*$/.test(item) ? []
    : Array.isArray(item) ? text_children(item) : [text_element(item)]);
}

class TextStack extends Element<TextStackProps> {
  static defaults: Partial<TextStackProps> = { gap: em(0.6) };
  static normalize(props: TextStackProps) {
    return { ...props, children: text_children(props.children) };
  }
  static layout(props: TextStackProps, query: LayoutQuery) {
    if (props.direction && !['horizontal', 'vertical'].includes(props.direction)) throw new TypeError('Unknown text stack direction');
    return stack_layout(props, query, props.direction === 'horizontal' ? 'width' : 'height');
  }
}

class TextRow extends TextStack {
  static defaults: Partial<TextStackProps> = { align: 'baseline' };
  static layout(props: TextStackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'width');
  }
}

class TextCol extends TextStack {
  static defaults: Partial<TextStackProps> = { align: 'stretch' };
  static layout(props: TextStackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'height');
  }
}
class TextBox extends Element<BoxProps, TextBoxProps> {
  static defaults: Partial<BoxProps> = { padding: em(0.6) };
  static normalize({ text, ...props }: TextBoxProps): BoxProps {
    return { ...props, children: text !== undefined ? new Text({ text }) : text_element(props.children) };
  }
  static layout = box_layout;
}

class TextFrame extends TextBox {
  static defaults: Partial<BoxProps> = { border_width: px(1) };
}

class TextFigure extends Element<BoxProps, TextFigureProps> {
  static normalize(input: TextFigureProps): BoxProps {
    const { caption, caption_style, gap = em(0.5), children, ...props } = scope_props(input, ['caption']);
    return { ...props,
      children: new VStack({ gap, align: 'stretch', children: [
        ...element_children(children), caption === undefined ? null : text_element(caption, caption_style),
      ] }),
    };
  }
  static layout = box_layout;
}

class TitleBox extends Element<BoxProps, TitleBoxProps> {
  static defaults: Partial<BoxProps> = { padding: em(0.75) };
  static normalize(input: TitleBoxProps): BoxProps {
    const { title, title_style, gap = em(0.6), children, ...props } = scope_props(input, ['title']);
    return { ...props,
      children: new VStack({ gap, align: 'stretch', children: [
        title === undefined ? null : text_element(title, { font_weight: 700, ...title_style }),
        ...text_children(children),
      ] }),
    };
  }
  static layout = box_layout;
}

class TitleFrame extends TitleBox {
  static defaults: Partial<BoxProps> = { border_width: px(1) };
}

class Bullets extends Element<StackProps, BulletsProps> {
  static defaults: Partial<StackProps> = { gap: em(0.5), align: 'stretch' };
  static normalize({ items, marker = '•', indent = em(1.2), children, ...props }: BulletsProps): StackProps {
    return { ...props,
      children: (items ?? text_children(children)).map(item => new HStack({
        align: 'baseline', children: [new Text({ text: marker, width: indent }),
          new Box({ grow: 1, shrink: 1, basis: px(0), children: text_element(item) })],
      })),
    };
  }
  static layout(p: StackProps, q: LayoutQuery) {
    return stack_layout(p, q, 'height');
  }
}

// Slides are ordinary fixed canvases with a measured title and flexible content
// region. Text uses pixels/em; resizing never silently magnifies the type scale.
class Slide extends Element<SlideData, SlideProps> {
  static defaults: Partial<SlideData> = { font_size: px(20), aspect: 16 / 9 };
  static data_bounds() {
    return null;
  }
  static normalize(input: SlideProps): SlideData {
    const { title, title_style, gap = em(0.8), children, ...props } = scope_props(input, ['title']);
    return { ...props,
      body: new VStack({ gap, align: 'stretch', children: [
        title === undefined ? null : text_element(title, { font_size: em(1.6), font_weight: 700, ...title_style }),
        new Box({ grow: 1, shrink: 1, basis: px(0), align: 'stretch', children:
          new TextCol({ children }) }),
      ] }),
    };
  }
  static layout(props: SlideData, query: LayoutQuery) {
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
  }
}

export { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide,
  text_element, text_children };
export type { TextStackProps, TextBoxProps, TextFigureProps, TitleBoxProps, BulletsProps, SlideProps };
