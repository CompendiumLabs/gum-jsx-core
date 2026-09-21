import { DEFAULTS } from './defaults'
import { resolve_theme, theme_color } from './theme'
import type { ThemeName } from './theme'
import { finite, nonnegative } from '../lib/checks'
import type { Paint } from './drawing'
import type { Size } from './geometry'
import { em, make_measure, normalize_length, px, resolve_font_size, resolve_length } from './units'
import type { Length, NormalizedLength, LengthContext } from './units'

type FontStyle = 'normal' | 'italic'
type LineCap = 'butt' | 'round' | 'square'
type LineJoin = 'miter' | 'round' | 'bevel'
type StyleSpec = Readonly<{
  theme?: ThemeName
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
  theme: ThemeName
  // Keep semantic paints so a nested theme can re-resolve inherited defaults.
  theme_paints?: Readonly<Partial<Record<'color' | 'fill' | 'stroke', string>>>
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
  theme: 'light',
  theme_paints: Object.freeze({ color: 'theme:foreground', stroke: 'theme:foreground' }),
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
function resolve_style(spec: StyleSpec = {}, inherited = DEFAULT_STYLE, context: Partial<LengthContext> = {}): Style {
  const measure = make_measure(context, { font_size: inherited.font_size })
  const path = measure.path || 'root'
  const theme = resolve_theme(spec.theme ?? inherited.theme)
  const theme_paints: Partial<Record<'color' | 'fill' | 'stroke', string>> = {}
  const paint = (key: 'color' | 'fill' | 'stroke') => {
    const token = inherited.theme_paints?.[key]
    // A caller may supply a resolved style with an explicitly replaced paint.
    const source = spec[key] ?? (token && theme_color(token, inherited.theme) === inherited[key]
      ? token : inherited[key])
    const value = theme_color(source, theme)
    if (source.startsWith('theme:')) theme_paints[key] = source
    return value
  }
  const font_size = resolve_font_size(spec.font_size, measure)
  const font_family = spec.font_family ?? inherited.font_family
  const font_weight = finite(spec.font_weight ?? inherited.font_weight, 'font_weight')
  const font_style = spec.font_style ?? inherited.font_style
  const line_height = normalize_length(spec.line_height ?? inherited.line_height, `${path}.line_height`)
  const color = paint('color')
  const fill = paint('fill')
  const stroke = paint('stroke')
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
  const stroke_width = normalize_length(spec.stroke_width ?? inherited.stroke_width, `${path}.stroke_width`)
  const opacity = finite(spec.opacity ?? inherited.opacity, 'opacity')
  if (opacity < 0 || opacity > 1) throw new RangeError('opacity must be between 0 and 1')
  const stroke_dasharray = Object.freeze((spec.stroke_dasharray ?? inherited.stroke_dasharray).map((value, index) => {
    const location = `${path}.stroke_dasharray[${index}]`
    const length = normalize_length(value, location)
    nonnegative(length.value, location)
    return length
  }))
  return Object.freeze({
    theme, theme_paints: Object.freeze(theme_paints),
    font_size, font_family, font_weight, font_style, line_height, color,
    fill, stroke, stroke_width,
    stroke_linecap: spec.stroke_linecap ?? inherited.stroke_linecap,
    stroke_linejoin: spec.stroke_linejoin ?? inherited.stroke_linejoin,
    stroke_miterlimit: spec.stroke_miterlimit ?? inherited.stroke_miterlimit,
    stroke_dasharray, opacity,
  })
}

// Scalar shape paint lengths refer to the shorter side of its resolved rectangle.
function resolve_paint(style: Style, size: Size, context: Partial<LengthContext> = {}): Paint {
  const { fill, stroke, font_size, stroke_linecap, stroke_linejoin, stroke_miterlimit } = style
  const measure = make_measure(context, { font_size })
  const fraction = Math.min(size.width, size.height)
  const stroke_width = nonnegative(resolve_length(
    style.stroke_width, measure, fraction, 'stroke_width',
  ), 'stroke_width')
  const stroke_dasharray = style.stroke_dasharray.map((value, index) =>
    resolve_length(value, measure, fraction, `stroke_dasharray[${index}]`))
  return { fill, stroke, stroke_width, stroke_linecap, stroke_linejoin, stroke_miterlimit,
    stroke_dasharray, opacity: style.opacity }
}

export { resolve_style, resolve_paint }
export type { StyleSpec, Style, FontStyle, LineCap, LineJoin }
