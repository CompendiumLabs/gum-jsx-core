import { finite, nonnegative } from '../lib/checks'
import { DEFAULTS } from './defaults'

type UnitLength = Readonly<{ value: number; unit: 'em' | 'px' | 'vw' | 'vh' }>
type Length = number | UnitLength
type NormalizedLength = Readonly<{
  value: number
  unit: 'fraction' | UnitLength['unit']
}>

// An absent reference is indefinite. A reference of zero is definite.
type ReferenceBox = Readonly<{ width?: number; height?: number }>
type LengthContext = Readonly<{
  font_size?: number
  reference: ReferenceBox
  viewport: ReferenceBox
  path: string
}>

const EMPTY_REFERENCE: ReferenceBox = Object.freeze({})

// Derive local measurement state without mutating or freezing caller-owned boxes.
function make_measure(context: Partial<LengthContext> = {}, patch: Partial<LengthContext> = {}): LengthContext {
  const { font_size, reference = EMPTY_REFERENCE, viewport = EMPTY_REFERENCE, path = '' } = { ...context, ...patch }
  return Object.freeze({ font_size, path,
    reference: Object.isFrozen(reference) ? reference : Object.freeze({ ...reference }),
    viewport: Object.isFrozen(viewport) ? viewport : Object.freeze({ ...viewport }),
  })
}

function length_path(context: Partial<LengthContext>, property: string): string {
  return context.path ? `${context.path}.${property}` : property
}

// Keep source lengths tagged until the relevant reference is established.
function em(value: number) {
  return Object.freeze({ value: finite(value, 'em'), unit: 'em' })
}

// Pixel lengths are independent of both the font and the containing box.
function px(value: number) {
  return Object.freeze({ value: finite(value, 'px'), unit: 'px' })
}

// Viewport units are percentages of the reference canvas, independent of nesting.
function vw(value: number) {
  return Object.freeze({ value: finite(value, 'vw'), unit: 'vw' })
}

function vh(value: number) {
  return Object.freeze({ value: finite(value, 'vh'), unit: 'vh' })
}

// Copy the input so normalization never freezes a caller's own object.
function normalize_length(length: Length | NormalizedLength, path = 'length'): NormalizedLength {
  const { value, unit } = typeof length === 'number'
    ? { value: length, unit: 'fraction' as const }
    : length

  finite(value, path)
  if (unit !== 'fraction' && unit !== 'em' && unit !== 'px' && unit !== 'vw' && unit !== 'vh') {
    throw new RangeError(`${path}: Unknown length unit: ${unit}`)
  }
  return Object.freeze({ value, unit })
}

// Intrinsic queries can retain the tagged dependency instead of guessing a size.
function measure_length(
  length: Length | NormalizedLength,
  context: Partial<LengthContext> = {},
  fraction?: number,
  property = 'length',
): number | NormalizedLength {
  const path = length_path(context, property)
  const normalized = normalize_length(length, path)
  const { value, unit } = normalized
  if (value === 0 || unit === 'px') return value

  const reference = unit === 'em' ? context.font_size : unit === 'vw' ? context.viewport?.width
    : unit === 'vh' ? context.viewport?.height : fraction
  if (reference === undefined) return normalized
  nonnegative(reference, `${path} ${unit} reference`)
  return finite((unit === 'vw' || unit === 'vh' ? value / 100 : value) * reference, path)
}

// Final layout must resolve every length; include the source property in errors.
function resolve_length(
  length: Length | NormalizedLength,
  context: Partial<LengthContext> = {},
  fraction?: number,
  property = 'length',
): number {
  const result = measure_length(length, context, fraction, property)
  if (typeof result === 'number') return result
  throw new UnresolvedLengthError(result, length_path(context, property))
}

// Fractions and em font sizes refer to the inherited font size.
function resolve_font_size(
  length?: Length,
  context: Partial<LengthContext> = {},
): number {
  const inherited = context.font_size ?? DEFAULTS.font_size
  nonnegative(inherited, 'inherited font_size')
  if (length === undefined) return inherited
  const measure = make_measure(context, { font_size: inherited })
  return nonnegative(resolve_length(length, measure, inherited, 'font_size'), length_path(measure, 'font_size'))
}

// Line height and other em lengths use the newly resolved local font size.
function resolve_line_height(
  length: Length | NormalizedLength = em(DEFAULTS.line_height),
  context: Partial<LengthContext> = {},
): number {
  const font_size = context.font_size ?? DEFAULTS.font_size
  nonnegative(font_size, 'font_size')
  const measure = make_measure(context, { font_size })
  return nonnegative(resolve_length(length, measure, font_size, 'line_height'), length_path(measure, 'line_height'))
}

class UnresolvedLengthError extends Error {
  readonly length: NormalizedLength
  readonly path: string

  constructor(length: NormalizedLength, path: string) {
    const reference = length.unit === 'em' ? 'font size' : length.unit === 'vw' ? 'viewport width'
      : length.unit === 'vh' ? 'viewport height' : 'fraction reference'
    super(`${path}: ${length.value} ${length.unit} requires a definite ${reference}`)
    this.name = 'UnresolvedLengthError'
    this.length = length
    this.path = path
  }
}

export {
  em, px, vw, vh, make_measure, normalize_length, measure_length, resolve_length,
  resolve_font_size, resolve_line_height, UnresolvedLengthError,
}
export type {
  UnitLength, Length, NormalizedLength, ReferenceBox, LengthContext,
}
