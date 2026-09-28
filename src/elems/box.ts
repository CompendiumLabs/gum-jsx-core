import { nonnegative } from '../lib/checks'
import { layout_content } from '../lib/composition'
import type { Alignment } from '../lib/composition'
import { DEFAULTS } from '../engine/defaults'
import { theme_color } from '../engine/theme'
import { draw_rect } from '../engine/drawing'
import { Element, content_child } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment, frame_connection, content_bounds } from '../engine/fragment'
import type { Fragment } from '../engine/fragment'
import type { PathCommand } from '../engine/path'
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
  border_radius?: RectRadius
  align?: Alignment
  clip?: boolean
}>

// Keep overflow outside the cutout visible. A single compound clip avoids
// duplicating content, including text and connection identifiers, across regions.
function cutout_fragment(fragment: Fragment, cutout: Rect): Fragment {
  const bounds = content_bounds(fragment)
  const x2 = bounds.x + bounds.width, y2 = bounds.y + bounds.height
  const left = Math.max(bounds.x, Math.min(x2, cutout.x))
  const right = Math.max(left, Math.min(x2, cutout.x + cutout.width))
  const top = Math.max(bounds.y, Math.min(y2, cutout.y))
  const bottom = Math.max(top, Math.min(y2, cutout.y + cutout.height))
  const regions = [
    make_rect(bounds.x, bounds.y, bounds.width, top - bounds.y),
    make_rect(bounds.x, bottom, bounds.width, y2 - bottom),
    make_rect(bounds.x, top, left - bounds.x, bottom - top),
    make_rect(right, top, x2 - right, bottom - top),
  ]
  const clip_path = regions
    .filter(region => region.width > 0 && region.height > 0)
    .flatMap(({ x, y, width, height }): PathCommand[] => [
      { kind: 'M', x, y }, { kind: 'L', x: x + width, y },
      { kind: 'L', x: x + width, y: y + height }, { kind: 'L', x, y: y + height }, { kind: 'Z' },
    ])
  return make_fragment({ ...fragment, clip_path })
}

// Clip a twice-wide stroke to the frame: exactly one border width remains
// inside, even when corners are rounded or the border fills the entire box.
// The clipped-away half is drawing construction, not layout overflow.
function frame_border(size: Size, width: number, color: string, radius: RectRadii, opacity = 1, cutout?: Rect): Fragment {
  const rect = make_rect(0, 0, size.width, size.height)
  const draw = draw_rect(rect, { fill: 'none', stroke: color, stroke_width: 2 * width, opacity }, radius)
  const border = make_fragment({ name: 'Border', size, draw: [draw], ink: opacity ? rect : null,
    clip: make_clip(rect, radius) })
  return cutout ? cutout_fragment(border, cutout) : border
}

// Decoration is local to this frame; inherited fill/stroke still style children.
// Border width is resolved before measurement, so fractions use the established
// parent's shorter side. Padding uses the corresponding parent axis on each side.
function box_layout(props: BoxProps, query: LayoutQuery, frame_cutout?: (size: Size) => Rect) {
  const padding = resolve_insets(props.padding, query.measure)
  const { width, height } = query.measure.reference
  const fraction = width === undefined || height === undefined ? undefined : Math.min(width, height)
  const border_width = nonnegative(resolve_length(props.border_width ?? px(0),
    query.measure, fraction, 'border_width'), 'border_width')
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
  const radius = resolve_rect_radius(props.border_radius ?? 0, size, query.measure)
  const corners = make_clip(rect, radius).radius!
  const draw = background === 'none' ? [] : [draw_rect(rect,
    { fill: background, stroke: 'none', stroke_width: 0, opacity: query.style.opacity }, corners)]
  const children = placement ? [placement] : []
  const cutout = frame_cutout?.(size)
  if (cutout && placement) {
    const clipped = cutout_fragment(make_fragment({ name: 'Clip', size, children }), cutout)
    children.splice(0, 1, place_fragment(clipped))
  }

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
      cutout)))
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
