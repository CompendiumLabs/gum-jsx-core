import type { LayoutQuery } from '../engine/pass'
import { layout_content } from '../lib/composition'
import { Element, content_child } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment } from '../engine/fragment'
import { make_rect } from '../engine/geometry'
import type { UnitLength } from '../engine/units'

type SvgProps = ElementProps & Readonly<{ width?: UnitLength; height?: UnitLength }>

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
    const { size, placement, guides, overflow } = layout_content(child, query)
    const children = placement ? [placement] : []
    const clip = make_rect(0, 0, size.width, size.height)
    return make_fragment({ size, children, guides, overflow, clip })
  }
}

export { Svg }
export type { SvgProps }
export { Rect } from './shapes'
export type { RectProps } from './shapes'
