import { finite } from '../lib/checks'
import { align_offset, layout_content, resolve_alignment } from '../lib/composition'
import type { Alignment } from '../lib/composition'
import { Element, element_children, content_child } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment, transform_guides } from '../engine/fragment'
import { make_size, make_point, make_rect, transform_rect } from '../engine/geometry'
import type { Transform, Size } from '../engine/geometry'
import { available, make_request, finish_size } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { resolve_font_size, resolve_length } from '../engine/units'
import type { Length } from '../engine/units'

type Side = 'top' | 'right' | 'bottom' | 'left'
type OverlayProps = ElementProps & Readonly<{ clip?: boolean }>
type RotateProps = ElementProps & Readonly<{ angle?: number; origin?: Alignment; resize?: boolean }>
type TransformBoxProps = ElementProps & Readonly<{ matrix?: Transform; resize?: boolean }>
type AttachProps = ElementProps & Readonly<{
  attachment?: Element; side?: Side; offset?: Length; at?: number; child_anchor?: number
}>
type AnchorProps = ElementProps & Readonly<{ align?: Alignment }>

// The first child sizes an overlay. Decorations see that established box and
// contribute ink/overflow but never enlarge the allocation.
class Overlay extends Element<OverlayProps> {
  static layout(props: OverlayProps, query: LayoutQuery) {
    const [base, ...decorations] = element_children(props.children)
    const { size, placement, guides } = layout_content(base, query)
    const children = placement ? [placement] : []
    const request = make_request({ width: available(size.width), height: available(size.height) })
    decorations.forEach((element, index) => {
      const fragment = query.child(element, request, size, index + 1)
      const font_size = resolve_font_size(element.props.font_size, query.style.font_size)
      const align = resolve_alignment(element.props.anchor ?? 'start')
      if (align.x === 'stretch' || align.y === 'stretch') throw new TypeError('An anchor selects a point')
      // Anchor locates the child's own reference point, just as in Group.
      const x = resolve_length(element.props.x ?? 0, { font_size, fraction: size.width }, 'x')
      const y = resolve_length(element.props.y ?? 0, { font_size, fraction: size.height }, 'y')
      children.push(place_fragment(fragment,
        make_point(x - fragment.size.width * align.x, y - fragment.size.height * align.y)))
    })
    return make_fragment({ size, children, guides,
      clip: props.clip ? make_rect(0, 0, size.width, size.height) : undefined })
  }
}

// A transform acts on a finished child. resize=true includes the transformed
// allocation; resize=false keeps its original frame and records visible overflow.
function transformed_layout(props: ElementProps & { resize?: boolean }, query: LayoutQuery,
  matrix: (size: Size) => Transform) {
  const child = content_child(props.children)
  const fragment = child ? query.child(child, make_request(), query.reference) : make_fragment({ size: make_size() })
  const transform = matrix(fragment.size)
  const bounds = transform_rect(make_rect(0, 0, fragment.size.width, fragment.size.height), make_point(), transform)!
  const resize = props.resize ?? true
  const size = finish_size(resize ? make_size(bounds.width, bounds.height) : fragment.size,
    query.request, query.sizing)
  const offset = resize ? make_point(-bounds.x, -bounds.y) : make_point()
  return make_fragment({ size, children: [place_fragment(fragment, offset, transform)] })
}

class TransformBox extends Element<TransformBoxProps> {
  static layout(props: TransformBoxProps, query: LayoutQuery) {
    return transformed_layout(props, query, () => props.matrix ?? [1, 0, 0, 1, 0, 0])
  }
}

class Rotate extends Element<RotateProps> {
  static layout(props: RotateProps, query: LayoutQuery) {
    return transformed_layout(props, query, size => {
      const angle = finite(props.angle ?? 0, 'angle') * Math.PI / 180
      const origin = resolve_alignment(props.origin ?? 'center')
      if (origin.x === 'stretch' || origin.y === 'stretch') throw new TypeError('Rotation origin selects a point')
      const x = size.width * origin.x, y = size.height * origin.y
      const cos = Math.cos(angle), sin = Math.sin(angle)
      return [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y]
    })
  }
}

// Attach keeps the main child's frame. Use outer Box padding when the attachment
// needs reserved space in a document; Plot performs that measurement itself.
class Attach extends Element<AttachProps> {
  static layout(props: AttachProps, query: LayoutQuery) {
    const { size, placement, guides } = layout_content(content_child(props.children), query)
    const children = placement ? [placement] : []
    const { side = 'bottom', at = 0.5, child_anchor = 0.5 } = props
    if (!['top', 'right', 'bottom', 'left'].includes(side)) throw new TypeError('Unknown attachment side')
    finite(at, 'at'); finite(child_anchor, 'child_anchor')
    const offset = resolve_length(props.offset ?? 0,
      { font_size: query.style.font_size, fraction: Math.min(size.width, size.height) }, 'offset')
    if (props.attachment) {
      const item = query.child(props.attachment, make_request(), size, 1)
      const horizontal = side === 'top' || side === 'bottom'
      const x = horizontal ? size.width * at - item.size.width * child_anchor
        : side === 'left' ? -offset - item.size.width : size.width + offset
      const y = !horizontal ? size.height * at - item.size.height * child_anchor
        : side === 'top' ? -offset - item.size.height : size.height + offset
      children.push(place_fragment(item, make_point(x, y)))
    }
    return make_fragment({ size, children, guides })
  }
}

// A point or line allocation can anchor content without changing its dimensions.
class Anchor extends Element<AnchorProps> {
  static layout(props: AnchorProps, query: LayoutQuery) {
    const child = content_child(props.children)
    const fragment = child ? query.child(child, make_request(), query.reference) : undefined
    const size = finish_size(make_size(), query.request, query.sizing)
    const alignment = resolve_alignment(props.align ?? 'center')
    const offset = align_offset(size, fragment?.size ?? make_size(), alignment)
    return make_fragment({ size, children: fragment ? [place_fragment(fragment, offset)] : [],
      guides: transform_guides(fragment?.guides ?? {}, offset.y) })
  }
}

export { Overlay, TransformBox, Rotate, Attach, Anchor }
export type { Side, OverlayProps, TransformBoxProps, RotateProps, AttachProps, AnchorProps }
