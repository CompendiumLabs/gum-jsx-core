import type { LayoutQuery } from '../engine/pass'
import { nonnegative } from '../lib/checks'
import { resolve_alignment, definite_reference } from '../lib/composition'
import { theme_color } from '../engine/theme'
import { Box, Frame, box_layout } from './box'
import type { BoxProps } from './box'
import { Element, content_child, element_children } from '../engine/element'
import type { Child, ElementProps } from '../engine/element'
import { make_fragment, place_fragment, transform_guides, frame_connection } from '../engine/fragment'
import { make_point, make_rect, make_size, make_clip, make_insets, resolve_insets, deflate_size } from '../engine/geometry'
import type { InsetSpec } from '../engine/geometry'
import { graph_size } from './graph'
import { available, exact, make_request, deflate_request, prepare_request, finish_size } from '../engine/layout'
import { HStack, VStack, stack_layout } from './stack'
import type { StackProps } from './stack'
import { resolve_rect_radius } from './shapes'
import { scope_props } from '../lib/props'
import type { Prefixed } from '../lib/props'
import { Text, Span } from './text'
import type { TextOptions } from './text'
import { em, px, resolve_length } from '../engine/units'
import type { Length } from '../engine/units'
import { draw_rect } from '../engine/drawing'

type TextStackProps = StackProps & Readonly<{ direction?: 'horizontal' | 'vertical' }>
type TextBoxProps = BoxProps & Readonly<{ text?: string }>
type TextFigureProps = BoxProps & Prefixed<'caption', TextOptions> & Readonly<{
  caption?: Child; caption_style?: TextOptions; gap?: Length
}>
type TitleBoxProps = BoxProps & Prefixed<'title', TextOptions>
  & Readonly<{ title?: Child; title_style?: TextOptions; gap?: Length }>
type TitleFrameTitleStyle = TextOptions & Pick<BoxProps,
  'padding' | 'border_width' | 'border_color' | 'background' | 'radius' | 'align'>
type TitleFrameProps = BoxProps & Prefixed<'title', TitleFrameTitleStyle> & Readonly<{
  title?: Child; title_style?: TitleFrameTitleStyle; gap?: Length
  title_position?: 'start' | 'center' | 'end' | number
  frame_aspect?: number
}>
type TitleFrameData = BoxProps & Readonly<{
  title_box?: Element; title_position?: TitleFrameProps['title_position']; gap?: Length
  frame_aspect?: number
}>
type SlideProps = ElementProps & Prefixed<'title', TextOptions> & Readonly<{
  title?: Child; title_style?: TextOptions; padding?: InsetSpec
  gap?: Length; background?: string; clip?: boolean
}>
type SlideData = SlideProps & Readonly<{ body: Element }>
type BulletsProps = ElementProps & Readonly<{
  items?: readonly Child[]; marker?: string; gap?: Length; indent?: Length
}>

// Text composition converts text at construction, so reflow always sees the same
// source elements. Existing figures and their parent-owned flex metadata survive.
function content_items(value: Child): Child[] {
  return Array.isArray(value) ? value.flatMap(content_items)
    : value == null || typeof value === 'boolean' ? [] : [value]
}

function text_element(value: Child, style: TextOptions = {}): Element {
  const items = content_items(value).filter(item => typeof item !== 'string' || !/^[ \t\r\n]*$/.test(item))
  // Preserve a sole block element (and its flex metadata). Mixed content is a
  // paragraph, even when one or more of its inline children happen to be math.
  return items.length && items.every(item => item instanceof Element && !(item instanceof Span))
    ? content_child(items)! : new Text({ ...style, children: value })
}

function text_children(value: Child = []): readonly Element[] {
  const values: readonly Child[] = Array.isArray(value) ? value : [value]
  return values.flatMap(item => item == null || typeof item === 'boolean' ? []
    : typeof item === 'string' && /^[ \t\r\n]*$/.test(item) ? []
    : Array.isArray(item) ? text_children(item) : [text_element(item)])
}

class TextStack extends Element<TextStackProps> {
  static defaults: Partial<TextStackProps> = { gap: em(0.6) }
  static normalize(props: TextStackProps) {
    return { ...props, children: text_children(props.children) }
  }
  static layout(props: TextStackProps, query: LayoutQuery) {
    if (props.direction && !['horizontal', 'vertical'].includes(props.direction)) throw new TypeError('Unknown text stack direction')
    return stack_layout(props, query, props.direction === 'horizontal' ? 'width' : 'height')
  }
}

class TextRow extends TextStack {
  static defaults: Partial<TextStackProps> = { align: 'baseline' }
  static layout(props: TextStackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'width')
  }
}

class TextCol extends TextStack {
  static defaults: Partial<TextStackProps> = { width: 'fill', align: 'fill' }
  static layout(props: TextStackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'height')
  }
}
class TextBox extends Element<BoxProps, TextBoxProps> {
  static defaults: Partial<BoxProps> = { width: 'fill', align: { x: 'fill' }, padding: em(0.6) }
  static normalize({ text, ...props }: TextBoxProps): BoxProps {
    return { ...props, children: text !== undefined ? new Text({ text }) : text_element(props.children) }
  }
  static layout = box_layout
}

class TextFrame extends TextBox {
  static defaults: Partial<BoxProps> = { border_width: px(1) }
}

class TextFigure extends Element<BoxProps, TextFigureProps> {
  static normalize(input: TextFigureProps): BoxProps {
    const { caption, caption_style, gap = em(0.5), children, ...props } = scope_props(input, ['caption'])
    return { ...props,
      children: new VStack({ gap, align: 'stretch', children: [
        ...element_children(children), caption === undefined ? null : text_element(caption, caption_style),
      ] }),
    }
  }
  static layout = box_layout
}

class TitleBox extends Element<BoxProps, TitleBoxProps> {
  static defaults: Partial<BoxProps> = { padding: em(0.75) }
  static normalize(input: TitleBoxProps): BoxProps {
    const { title, title_style, gap = em(0.6), children, ...props } = scope_props(input, ['title'])
    return { ...props,
      children: new VStack({ gap, align: 'stretch', children: [
        title === undefined ? null : text_element(title, { font_weight: 700, ...title_style }),
        ...text_children(children),
      ] }),
    }
  }
  static layout = box_layout
}

class TitleFrame extends Element<TitleFrameData, TitleFrameProps> {
  static defaults: Partial<TitleFrameProps> = { padding: em(0.75), border_width: px(1) }
  static normalize(input: TitleFrameProps): TitleFrameData {
    const { title, title_style = {}, title_position = 'center', gap = em(0.6), children, ...props }
      = scope_props(input, ['title'], ['title_position'])
    const { padding = [em(0.6), em(0.3)], border_width = props.border_width,
      border_color = props.border_color, background = props.background,
      radius = em(0.3), align = 'center', font_size, ...text } = title_style
    return { ...props, gap, title_position,
      children: new VStack({ gap, align: 'stretch', children: text_children(children) }),
      title_box: title == null ? undefined : new Frame({
        width: 'fit', padding, border_width, border_color, background, radius, align, font_size,
        children: text_element(title, text),
      }),
    }
  }
  static layout(props: TitleFrameData, query: LayoutQuery) {
    const frame_aspect = props.frame_aspect === undefined ? undefined
      : nonnegative(props.frame_aspect, `${query.path}.frame_aspect`)
    if (frame_aspect === 0) throw new RangeError(`${query.path}.frame_aspect must be positive`)
    if (!props.title_box) {
      const sizing = { ...query.sizing, aspect: query.sizing.aspect ?? frame_aspect }
      return box_layout(props, { ...query, sizing, request: prepare_request(query.request, sizing) })
    }
    const position = resolve_alignment(props.title_position ?? 'center').x
    if (typeof position !== 'number') throw new TypeError('Title position must select a point')
    const fixed = definite_reference(query.request, query.sizing)
    const title = query.child(props.title_box, make_request({
      width: query.request.width.kind === 'natural' ? query.request.width : available(query.request.width.value),
    }), fixed, 1)
    const half = title.size.height / 2
    const padding = resolve_insets(props.padding,
      { font_size: query.style.font_size, reference: query.reference, path: query.path })
    const gap = nonnegative(resolve_length(props.gap ?? em(0.6), {
      font_size: query.style.font_size,
      fraction: fixed.height,
    }, `${query.path}.gap`), 'gap')
    const body_request = deflate_request(query.request, make_insets({ top: half }))
    const height = query.sizing.height
    const body_sizing = { ...query.sizing,
      aspect: frame_aspect,
      width: { ...query.sizing.width,
        min: Math.min(query.sizing.width.max, Math.max(query.sizing.width.min, title.size.width)) },
      height: { ...height,
        preferred: height.preferred === undefined ? undefined : Math.max(0, height.preferred - half),
        min: Math.max(0, height.min - half), max: Math.max(0, height.max - half) },
    }
    // The generic aspect belongs to the complete element. Only frame_aspect
    // applies to the bordered body, whose allocation excludes the title overhang.
    // The body is a part, not a node: only the complete element carries the id.
    const { id, ...frame } = props
    const layout_body = (request = body_request) => box_layout({ ...frame, padding: {
      left: px(padding.left), right: px(padding.right), bottom: px(padding.bottom),
      top: px(Math.max(padding.top, half + gap)),
    } }, { ...query, request: prepare_request(request, body_sizing), sizing: body_sizing },
    size => make_rect((size.width - title.size.width) * position, 0, title.size.width, half))
    let body = layout_body()
    const measured = make_size(body.size.width, body.size.height + half)
    const size = finish_size(measured, query.request, query.sizing)
    // A natural outer aspect can add space after measurement. Redraw the body
    // at that allocation so its border and aligned content follow the final box.
    const body_height = Math.max(0, size.height - half)
    if (measured.width !== size.width || measured.height !== size.height) {
      body = layout_body(make_request({ width: exact(size.width), height: exact(body_height) }))
    }
    // One outline spans the frame and its overhanging title, so a centered anchor
    // and the side ports agree. Only the body's lower corners reach that outline.
    const round = make_clip(make_rect(0, 0, body.size.width, body.size.height),
      resolve_rect_radius(props.radius ?? 0, body.size, query)).radius!
    const corner = (key: 'bl' | 'br') => 'tl' in round ? round[key] : round
    const boundary = make_clip(make_rect(0, 0, size.width, size.height),
      { tl: make_point(), tr: make_point(), bl: corner('bl'), br: corner('br') })
    return make_fragment({ size, ...frame_connection(id, boundary),
      guides: transform_guides(body.guides, half),
      content: body.content && make_rect(body.content.x, body.content.y + half, body.content.width, body.content.height),
      children: [place_fragment(body, make_point(0, half)),
        place_fragment(title, make_point((size.width - title.size.width) * position, 0))],
    })
  }
}

class Bullets extends Element<StackProps, BulletsProps> {
  static defaults: Partial<StackProps> = { gap: em(0.5), align: 'stretch' }
  static normalize({ items, marker = '•', indent = em(1.2), children, ...props }: BulletsProps): StackProps {
    return { ...props,
      children: (items ?? text_children(children)).map(item => new HStack({
        align: 'baseline', children: [new Text({ text: marker, width: indent }),
          new Box({ grow: 1, shrink: 1, basis: px(0), children: text_element(item) })],
      })),
    }
  }
  static layout(p: StackProps, q: LayoutQuery) {
    return stack_layout(p, q, 'height')
  }
}

// Slides are ordinary fixed canvases with a measured title and flexible content
// region. Text uses pixels/em; resizing never silently magnifies the type scale.
class Slide extends Element<SlideData, SlideProps> {
  static defaults: Partial<SlideData> = { aspect: 16 / 9 }
  static data_bounds() {
    return null
  }
  static normalize(input: SlideProps): SlideData {
    const { title, title_style, gap = em(0.8), children, ...props } = scope_props(input, ['title'])
    const content = text_children(children)
    return { ...props,
      body: new VStack({ gap, align: 'fill', children: [
        title === undefined ? null : text_element(title, { font_size: em(1.6), font_weight: 700, ...title_style }),
        // A single layout receives the body allocation directly. An extra column
        // would probe its natural height, losing the budget for nested flex items.
        new Box({ grow: 1, shrink: 1, basis: px(0), align: 'fill', children:
          content.length === 1 ? content[0] : new TextCol({ children: content }) }),
      ] }),
    }
  }
  static layout(props: SlideData, query: LayoutQuery) {
    const size = graph_size(query, 16 / 9)
    const padding = resolve_insets(props.padding ?? em(1.5),
      { font_size: query.style.font_size, reference: size, path: query.path })
    const inner = deflate_size(size, padding)
    const fragment = query.child(props.body, make_request({ width: exact(inner.width), height: exact(inner.height) }), inner)
    const area = make_rect(0, 0, size.width, size.height)
    const background = theme_color(props.background ?? 'none', query.style.theme)
    return make_fragment({ size, content: make_rect(padding.left, padding.top, inner.width, inner.height),
      draw: background === 'none' ? [] : [draw_rect(area, { fill: background, stroke: 'none', stroke_width: 0,
        opacity: query.style.opacity })],
      children: [place_fragment(fragment, make_point(padding.left, padding.top))],
      clip: props.clip ? area : undefined })
  }
}

export { TextStack, TextRow, TextCol, TextBox, TextFrame, TextFigure, TitleBox, TitleFrame, Bullets, Slide,
  text_element, text_children }
export type { TextStackProps, TextBoxProps, TextFigureProps, TitleBoxProps, TitleFrameProps, TitleFrameTitleStyle, BulletsProps, SlideProps }
