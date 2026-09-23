import { Element, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { draw_image } from '../engine/drawing'
import { make_fragment } from '../engine/fragment'
import { make_rect } from '../engine/geometry'
import { shape_size } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { png_size } from '../lib/png'

type PngImageProps = ElementProps & Readonly<{ data: string }>

class PngImage extends Element<PngImageProps> {
  static layout(props: PngImageProps, query: LayoutQuery) {
    if (element_children(props.children).length) throw new TypeError('PngImage has no content children')
    const intrinsic = query.prepare('png-size', () => png_size(props.data))
    const aspect = intrinsic.width / intrinsic.height
    const sizing = { ...query.sizing, aspect: query.sizing.aspect ?? aspect }
    // Natural images use their pixel dimensions; specified axes and offers use
    // the same aspect-aware sizing as shapes.
    const natural = query.request.width.kind === 'natural' && query.request.height.kind === 'natural'
      && sizing.width.preferred === undefined && sizing.height.preferred === undefined
      && sizing.width.max === Infinity && sizing.height.max === Infinity
    const size = shape_size(query.request, natural
      ? { ...sizing, height: { ...sizing.height, preferred: intrinsic.height } } : sizing)
    // Resolve SVG's centered contain behavior here so every exporter agrees,
    // including when exact allocations override the preferred aspect ratio.
    const scale = Math.min(size.width / intrinsic.width, size.height / intrinsic.height)
    const width = intrinsic.width * scale, height = intrinsic.height * scale
    const rect = make_rect((size.width - width) / 2, (size.height - height) / 2, width, height)
    return make_fragment({ size, draw: [draw_image(rect, props.data, query.style.opacity)] })
  }
}

export { PngImage }
export type { PngImageProps }

// Generated prop registrations; run the workspace props:generate command.
import { register_props } from '../engine/prop_validation'
import { prop_schemas } from '../prop-schemas'
register_props(PngImage, prop_schemas.PngImage)
