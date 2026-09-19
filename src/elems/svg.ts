import type { LayoutQuery } from '../engine/pass'
import { fit_scale, layout_content } from '../lib/composition'
import { Element, content_child } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment, transform_guides } from '../engine/fragment'
import { make_rect, make_point, make_size, make_insets, inflate_size } from '../engine/geometry'
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
    const layout = layout_content(child, query)
    // A hugging axis also takes in the space its content reserves outside its
    // frame. Established axes keep their size and clip that outset as before.
    const reserved = layout.placement?.fragment.outset ?? make_insets()
    const hugs = prepare_request(query.request, query.sizing)
    const outset = make_insets({
      ...(hugs.width.kind === 'exact' ? {} : { left: reserved.left, right: reserved.right }),
      ...(hugs.height.kind === 'exact' ? {} : { top: reserved.top, bottom: reserved.bottom }),
    })
    // Maxima on hugging axes bound the completed figure, not just its viewport.
    // Reflow uses the original offers; only then shrink uniformly if necessary.
    // Exact axes keep their allocations, and advisory offers alone never scale.
    const measured = layout.placement?.fragment.size ?? make_size()
    const extent = inflate_size(make_size(
      hugs.width.kind === 'exact' ? layout.size.width : Math.max(layout.size.width, measured.width),
      hugs.height.kind === 'exact' ? layout.size.height : Math.max(layout.size.height, measured.height),
    ), outset)
    const limits = {
      width: hugs.width.kind !== 'exact' && Number.isFinite(query.sizing.width.max) ? query.sizing.width.max : undefined,
      height: hugs.height.kind !== 'exact' && Number.isFinite(query.sizing.height.max) ? query.sizing.height.max : undefined,
    }
    const scale = fit_scale(extent, limits, true)
    const size = finish_size(make_size(extent.width * scale, extent.height * scale), query.request, query.sizing)
    const children = layout.placement ? [place_fragment(layout.placement.fragment,
      make_point((layout.placement.offset.x + outset.left) * scale, (layout.placement.offset.y + outset.top) * scale),
      scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0])] : []
    const guides = transform_guides(layout.guides, outset.top * scale, scale)
    const clip = make_rect(0, 0, size.width, size.height)
    const background = theme_color(props.background ?? 'none', query.style.theme)
    const draw = background === 'none' ? [] : [draw_rect(clip,
      { fill: background, stroke: 'none', stroke_width: 0, opacity: query.style.opacity })]
    return make_fragment({ size, children, guides, clip, draw })
  }
}

export { Svg }
export type { SvgProps }
export { Rect } from './shapes'
export type { RectProps } from './shapes'
