import { nonnegative } from '../lib/checks'
import { layout_content } from '../lib/composition'
import type { Alignment } from '../lib/composition'
import { DEFAULTS } from '../engine/defaults'
import { theme_color } from '../engine/theme'
import { draw_rect } from '../engine/drawing'
import { Element, content_child } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment, frame_connection } from '../engine/fragment'
import type { Fragment } from '../engine/fragment'
import {
  make_point, make_rect, make_clip, make_insets, add_insets,
  resolve_insets, deflate_size, map_radii, read_point,
} from '../engine/geometry'
import type { Rect, RectRadii, Size, InsetSpec } from '../engine/geometry'
import type { LayoutQuery } from '../engine/pass'
import { resolve_rect_radius } from './shapes'
import type { RectRadius } from './shapes'
import { px, resolve_length } from '../engine/units'
import type { Length } from '../engine/units'

type BoxProps = ElementProps & Readonly<{
  padding?: InsetSpec
  border_width?: Length
  border_color?: string
  background?: string
  radius?: RectRadius
  align?: Alignment
  clip?: boolean
}>

// Clip a twice-wide stroke to the frame: exactly one border width remains
// inside, even when corners are rounded or the border fills the entire box.
// The clipped-away half is drawing construction, not layout overflow.
function frame_border(size: Size, width: number, color: string, radius: RectRadii, opacity = 1, cutout?: Rect): Fragment {
  const rect = make_rect(0, 0, size.width, size.height)
  const draw = draw_rect(rect, { fill: 'none', stroke: color, stroke_width: 2 * width, opacity }, radius)
  const border = make_fragment({ name: 'Border', size, draw: [draw], ink: opacity ? rect : null,
    clip: make_clip(rect, radius) })
  if (!cutout) return border
  const left = Math.max(0, Math.min(size.width, cutout.x))
  const right = Math.max(left, Math.min(size.width, cutout.x + cutout.width))
  const top = Math.max(0, Math.min(size.height, cutout.y))
  const bottom = Math.max(top, Math.min(size.height, cutout.y + cutout.height))
  const regions = [
    make_rect(0, 0, size.width, top),
    make_rect(0, bottom, size.width, size.height - bottom),
    make_rect(0, top, left, bottom - top),
    make_rect(right, top, size.width - right, bottom - top),
  ]
  return make_fragment({ name: 'Border', size, children: regions
    .filter(region => region.width > 0 && region.height > 0)
    .map(clip => place_fragment(make_fragment({ size, children: [place_fragment(border)], clip }))) })
}

// Decoration is local to this frame; inherited fill/stroke still style children.
// Border width is resolved before measurement, so fractions use the established
// parent's shorter side. Padding uses the corresponding parent axis on each side.
function box_layout(props: BoxProps, query: LayoutQuery, border_cutout?: (size: Size) => Rect) {
  const { font_size } = query.style
  const basis = { font_size, reference: query.reference, path: query.path }
  const padding = resolve_insets(props.padding, basis)
  const { width, height } = query.reference
  const fraction = width === undefined || height === undefined ? undefined : Math.min(width, height)
  const border_width = nonnegative(resolve_length(props.border_width ?? px(0),
    { font_size, fraction }, `${query.path}.border_width`), 'border_width')
  const border = make_insets({ left: border_width, top: border_width,
    right: border_width, bottom: border_width })
  const background = theme_color(props.background ?? 'none', query.style.theme)
  const border_color = theme_color(props.border_color ?? query.style.color, query.style.theme)
  if (typeof background !== 'string' || typeof border_color !== 'string') {
    throw new TypeError('Box background and border_color must be paint strings')
  }

  const child = content_child(props.children)
  const layout = layout_content(child, query, add_insets(padding, border), props.align)
  const { size, content, guides, overflow, placement } = layout
  const rect = make_rect(0, 0, size.width, size.height)
  const radius = resolve_rect_radius(props.radius ?? 0, size, query)
  const corners = make_clip(rect, radius).radius!
  const draw = background === 'none' ? [] : [draw_rect(rect,
    { fill: background, stroke: 'none', stroke_width: 0, opacity: query.style.opacity }, corners)]
  const children = placement ? [placement] : []

  // Overflow clipping applies inside the border, including the padding area.
  // Draw the border last so content cannot paint over it when clipping is off.
  if (props.clip && placement) {
    const inner = deflate_size(size, border)
    const area = make_rect(border_width, border_width, inner.width, inner.height)
    const radius = map_radii(corners, value => {
      const { x, y } = read_point(value)
      return make_point(Math.max(0, x - border_width), Math.max(0, y - border_width))
    })
    const clipped = make_fragment({ name: 'Clip', size, children,
      clip: make_clip(area, radius) })
    children.splice(0, 1, place_fragment(clipped))
  }
  if (border_width > 0 && border_color !== 'none') {
    children.push(place_fragment(frame_border(size, border_width, border_color, corners, query.style.opacity,
      border_cutout?.(size))))
  }
  return make_fragment({ size, content, guides, overflow, draw, children,
    ...frame_connection(props.id, make_clip(rect, corners)) })
}

class Box extends Element<BoxProps> {
  static layout = box_layout
}

class Frame extends Element<BoxProps> {
  static layout(props: BoxProps, query: LayoutQuery) {
    return box_layout({ ...props, border_width: props.border_width ?? px(DEFAULTS.stroke_width) }, query)
  }
}

export { Box, Frame, box_layout }
export type { BoxProps }
