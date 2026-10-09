import { freeze_owned } from '../lib/immutable'
import { DEFAULTS } from './defaults'
import { resolve_theme, theme_color } from './theme'
import type { ThemeName } from './theme'
import { finite, nonnegative } from '../lib/checks'
import { light, regular, bold } from '../lib/constants'
import type { Paint } from './drawing'
import type { Size } from './geometry'
import { em, make_measure, normalize_length, px, resolve_font_size, resolve_length } from './units'
import type { Length, NormalizedLength, LengthContext } from './units'

type FontStyle = 'normal' | 'italic'
const FONT_WEIGHTS = freeze_owned({ light, regular, normal: regular, bold })
type FontWeight = number | keyof typeof FONT_WEIGHTS
type LineCap = 'butt' | 'round' | 'square'
type LineJoin = 'miter' | 'round' | 'bevel'
type PaintKey = 'color' | 'fill' | 'stroke' | 'halo_color'
type StyleSpec = Readonly<{
  theme?: ThemeName
  font_size?: Length
  font_family?: string
  math_font?: string
  font_weight?: FontWeight
  font_style?: FontStyle
  line_height?: Length
  color?: string
  halo_color?: string
  halo_width?: Length
  fill?: string
  stroke?: string
  stroke_width?: Length
  stroke_linecap?: LineCap
  stroke_linejoin?: LineJoin
  stroke_miterlimit?: number
  stroke_dasharray?: Length | readonly Length[]
  opacity?: number
}>
type Style = Readonly<{
  theme: ThemeName
  // Keep semantic paints so a nested theme can re-resolve inherited defaults.
  theme_paints?: Readonly<Partial<Record<PaintKey, string>>>
  font_size: number
  font_family: string
  math_font?: string
  font_weight: number
  font_style: FontStyle
  line_height: NormalizedLength
  color: string
  halo_color: string
  halo_width: NormalizedLength
  fill: string
  stroke: string
  stroke_width: NormalizedLength
  stroke_linecap: LineCap
  stroke_linejoin: LineJoin
  stroke_miterlimit: number
  stroke_dasharray: readonly NormalizedLength[]
  opacity: number
}>

const resolved_styles = new WeakSet<Style>()
function is_resolved_style(style: Style): boolean {
  return resolved_styles.has(style)
}

const DEFAULT_STYLE: Style = freeze_owned({
  theme: 'light',
  theme_paints: freeze_owned({ color: 'theme:foreground', stroke: 'theme:foreground' }),
  font_size: DEFAULTS.font_size,
  font_family: DEFAULTS.font_family,
  font_weight: DEFAULTS.font_weight,
  font_style: 'normal',
  line_height: normalize_length(em(DEFAULTS.line_height)),
  color: DEFAULTS.color,
  halo_color: DEFAULTS.halo_color,
  halo_width: normalize_length(em(DEFAULTS.halo_width)),
  fill: DEFAULTS.fill,
  stroke: DEFAULTS.stroke,
  stroke_width: normalize_length(px(DEFAULTS.stroke_width)),
  stroke_linecap: 'butt',
  stroke_linejoin: 'miter',
  stroke_miterlimit: DEFAULTS.stroke_miterlimit,
  stroke_dasharray: freeze_owned([]), opacity: 1,
})

// Resolve inherited font size before sizing. Paint lengths await shape geometry.
function resolve_style(spec: StyleSpec = {}, inherited = DEFAULT_STYLE, context: Partial<LengthContext> = {}): Style {
  const measure = make_measure(context, { font_size: inherited.font_size })
  const path = measure.path || 'root'
  const theme = resolve_theme(spec.theme ?? inherited.theme)
  const theme_paints: Partial<Record<PaintKey, string>> = {}
  const paint = (key: PaintKey) => {
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
  const math_font = spec.math_font ?? inherited.math_font
  if (math_font !== undefined && (typeof math_font !== 'string' || !math_font.trim())) {
    throw new TypeError(`${path}.math_font must be a nonempty font family`)
  }
  const weight = spec.font_weight ?? inherited.font_weight
  if (typeof weight === 'string' && !Object.hasOwn(FONT_WEIGHTS, weight)) {
    throw new TypeError(`${path}.font_weight must be a number, light, regular, normal, or bold; received ${weight}`)
  }
  const font_weight = finite(typeof weight === 'string' ? FONT_WEIGHTS[weight] : weight, 'font_weight')
  const font_style = spec.font_style ?? inherited.font_style
  const line_height = normalize_length(spec.line_height ?? inherited.line_height, `${path}.line_height`)
  const color = paint('color')
  const halo_color = paint('halo_color')
  const fill = paint('fill')
  const stroke = paint('stroke')
  if ([font_family, color, halo_color, fill, stroke].some(value => typeof value !== 'string')) {
    throw new TypeError(`${path}: font family and paints must be strings`)
  }
  if (!font_family || font_weight < 1 || font_weight > 1000) {
    throw new RangeError(`${path}: expected a font family and weight from 1 to 1000`)
  }
  if (font_style !== 'normal' && font_style !== 'italic') {
    throw new TypeError(`${path}: font_style must be normal or italic`)
  }
  nonnegative(line_height.value, `${path}.line_height`)
  const halo_width = normalize_length(spec.halo_width ?? inherited.halo_width, `${path}.halo_width`)
  nonnegative(halo_width.value, `${path}.halo_width`)
  const stroke_width = normalize_length(spec.stroke_width ?? inherited.stroke_width, `${path}.stroke_width`)
  const opacity = finite(spec.opacity ?? inherited.opacity, 'opacity')
  if (opacity < 0 || opacity > 1) throw new RangeError('opacity must be between 0 and 1')
  const dashes = spec.stroke_dasharray ?? inherited.stroke_dasharray
  const dash_lengths = Array.isArray(dashes) ? dashes : [dashes, dashes]
  const stroke_dasharray = freeze_owned(dash_lengths.map((value, index) => {
    const location = `${path}.stroke_dasharray[${index}]`
    const length = normalize_length(value, location)
    nonnegative(length.value, location)
    return length
  }))
  const style: Style = freeze_owned({
    theme, theme_paints: freeze_owned(theme_paints),
    font_size, font_family, font_weight, font_style, line_height, color,
    ...(math_font === undefined ? {} : { math_font }),
    halo_color, halo_width, fill, stroke, stroke_width,
    stroke_linecap: spec.stroke_linecap ?? inherited.stroke_linecap,
    stroke_linejoin: spec.stroke_linejoin ?? inherited.stroke_linejoin,
    stroke_miterlimit: spec.stroke_miterlimit ?? inherited.stroke_miterlimit,
    stroke_dasharray, opacity,
  })
  resolved_styles.add(style)
  return style
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

export { resolve_style, resolve_paint, is_resolved_style }
export type { StyleSpec, Style, FontStyle, FontWeight, LineCap, LineJoin }
