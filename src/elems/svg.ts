import type { LayoutQuery } from '../engine/pass'
import { layout_content } from '../lib/composition'
import { Element, content_child } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment, transform_guides } from '../engine/fragment'
import { make_rect, make_point, make_insets, inflate_size } from '../engine/geometry'
import { prepare_request, finish_size } from '../engine/layout'
import { draw_rect } from '../engine/drawing'
import { theme_color } from '../engine/theme'
import type { UnitLength } from '../engine/units'

type SvgProps = ElementProps & Readonly<{ width?: UnitLength; height?: UnitLength; background?: string }>

class Svg extends Element<SvgProps> {
  static layout(props: SvgProps, query: LayoutQuery) {
    // Omitted axes hug content. Specified viewport lengths remain explicit pixels;
    // a tight resize changes layout rather than magnifying a completed drawing.
    for (const axis of ['width', 'height'] as const) {
      if (props[axis] !== undefined && props[axis].unit !== 'px') {
        throw new TypeError(`Svg.${axis} requires px()`)
      }
    }
    const child = content_child(props.children)
    const layout = layout_content(child, query), { overflow } = layout
    // A hugging axis also takes in the space its content reserves outside its
    // frame. Established axes keep their size and clip that outset as before.
    const reserved = layout.placement?.fragment.outset ?? make_insets()
    const hugs = prepare_request(query.request, query.sizing)
    const outset = make_insets({
      ...(hugs.width.kind === 'exact' ? {} : { left: reserved.left, right: reserved.right }),
      ...(hugs.height.kind === 'exact' ? {} : { top: reserved.top, bottom: reserved.bottom }),
    })
    const size = finish_size(inflate_size(layout.size, outset), query.request, query.sizing)
    const children = layout.placement ? [place_fragment(layout.placement.fragment,
      make_point(layout.placement.offset.x + outset.left, layout.placement.offset.y + outset.top))] : []
    const guides = transform_guides(layout.guides, outset.top)
    const clip = make_rect(0, 0, size.width, size.height)
    const background = theme_color(props.background ?? 'none', query.style.theme)
    const draw = background === 'none' ? [] : [draw_rect(clip,
      { fill: background, stroke: 'none', stroke_width: 0, opacity: query.style.opacity })]
    return make_fragment({ size, children, guides, overflow, clip, draw })
  }
}

export { Svg }
export type { SvgProps }
export { Rect } from './shapes'
export type { RectProps } from './shapes'
