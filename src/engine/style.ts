import { DEFAULTS } from './defaults'
import { finite, nonnegative } from '../lib/checks'
import type { Paint } from './drawing'
import type { Size } from './geometry'
import { em, normalize_length, px, resolve_font_size, resolve_length } from './units'
import type { Length, NormalizedLength } from './units'

type FontStyle = 'normal' | 'italic'
type LineCap = 'butt' | 'round' | 'square'
type LineJoin = 'miter' | 'round' | 'bevel'
type StyleSpec = Readonly<{
  font_size?: Length
  font_family?: string
  font_weight?: number
  font_style?: FontStyle
  line_height?: Length
  color?: string
  fill?: string
  stroke?: string
  stroke_width?: Length
  stroke_linecap?: LineCap
  stroke_linejoin?: LineJoin
  stroke_miterlimit?: number
  stroke_dasharray?: readonly Length[]
  opacity?: number
}>
type Style = Readonly<{
  font_size: number
  font_family: string
  font_weight: number
  font_style: FontStyle
  line_height: NormalizedLength
  color: string
  fill: string
  stroke: string
  stroke_width: NormalizedLength
  stroke_linecap: LineCap
  stroke_linejoin: LineJoin
  stroke_miterlimit: number
  stroke_dasharray: readonly NormalizedLength[]
  opacity: number
}>

const DEFAULT_STYLE: Style = Object.freeze({
  font_size: DEFAULTS.font_size,
  font_family: DEFAULTS.font_family,
  font_weight: DEFAULTS.font_weight,
  font_style: 'normal',
  line_height: normalize_length(em(DEFAULTS.line_height)),
  color: DEFAULTS.color,
  fill: DEFAULTS.fill,
  stroke: DEFAULTS.stroke,
  stroke_width: normalize_length(px(DEFAULTS.stroke_width)),
  stroke_linecap: 'butt',
  stroke_linejoin: 'miter',
  stroke_miterlimit: DEFAULTS.stroke_miterlimit,
  stroke_dasharray: Object.freeze([]), opacity: 1,
})

// Resolve inherited font size before sizing. Paint lengths await shape geometry.
function resolve_style(spec: StyleSpec = {}, inherited = DEFAULT_STYLE, path = 'root'): Style {
  const font_size = resolve_font_size(spec.font_size, inherited.font_size, `${path}.font_size`)
  const font_family = spec.font_family ?? inherited.font_family
  const font_weight = finite(spec.font_weight ?? inherited.font_weight, 'font_weight')
  const font_style = spec.font_style ?? inherited.font_style
  const line_height = normalize_length(spec.line_height ?? inherited.line_height)
  const color = spec.color ?? inherited.color
  const fill = spec.fill ?? inherited.fill
  const stroke = spec.stroke ?? inherited.stroke
  if ([font_family, color, fill, stroke].some(value => typeof value !== 'string')) {
    throw new TypeError(`${path}: font family and paints must be strings`)
  }
  if (!font_family || font_weight < 1 || font_weight > 1000) {
    throw new RangeError(`${path}: expected a font family and weight from 1 to 1000`)
  }
  if (font_style !== 'normal' && font_style !== 'italic') {
    throw new TypeError(`${path}: font_style must be normal or italic`)
  }
  nonnegative(line_height.value, `${path}.line_height`)
  const stroke_width = normalize_length(spec.stroke_width ?? inherited.stroke_width)
  const opacity = finite(spec.opacity ?? inherited.opacity, 'opacity')
  if (opacity < 0 || opacity > 1) throw new RangeError('opacity must be between 0 and 1')
  const stroke_dasharray = Object.freeze((spec.stroke_dasharray ?? inherited.stroke_dasharray).map(value => {
    const length = normalize_length(value)
    nonnegative(length.value, 'stroke_dasharray')
    return length
  }))
  return Object.freeze({
    font_size, font_family, font_weight, font_style, line_height, color,
    fill, stroke, stroke_width,
    stroke_linecap: spec.stroke_linecap ?? inherited.stroke_linecap,
    stroke_linejoin: spec.stroke_linejoin ?? inherited.stroke_linejoin,
    stroke_miterlimit: spec.stroke_miterlimit ?? inherited.stroke_miterlimit,
    stroke_dasharray, opacity,
  })
}

// Scalar shape paint lengths refer to the shorter side of its resolved rectangle.
function resolve_paint(style: Style, size: Size, path: string): Paint {
  const { fill, stroke, font_size, stroke_linecap, stroke_linejoin, stroke_miterlimit } = style
  const basis = { font_size, fraction: Math.min(size.width, size.height) }
  const stroke_width = nonnegative(resolve_length(
    style.stroke_width, basis, `${path}.stroke_width`,
  ), 'stroke_width')
  const stroke_dasharray = style.stroke_dasharray.map(value => resolve_length(value, basis, 'stroke_dasharray'))
  return { fill, stroke, stroke_width, stroke_linecap, stroke_linejoin, stroke_miterlimit,
    stroke_dasharray, opacity: style.opacity }
}

export { resolve_style, resolve_paint }
export type { StyleSpec, Style, FontStyle, LineCap, LineJoin }
