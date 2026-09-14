import { finite, nonnegative } from '../lib/checks';
import { DEFAULTS } from './defaults';

type UnitLength = Readonly<{ value: number; unit: 'em' | 'px' }>;
type Length = number | UnitLength;
type NormalizedLength = Readonly<{
  value: number;
  unit: 'fraction' | 'em' | 'px';
}>;

// An absent reference is indefinite. A reference of zero is definite.
type LengthBasis = Readonly<{ font_size?: number; fraction?: number }>;
type ReferenceBox = Readonly<{ width?: number; height?: number }>;
type LengthContext = Readonly<{
  font_size?: number;
  reference?: ReferenceBox;
  path?: string;
}>;

// Keep source lengths tagged until the relevant reference is established.
function em(value: number) {
  return Object.freeze({ value: finite(value, 'em'), unit: 'em' });
}

// Pixel lengths are independent of both the font and the containing box.
function px(value: number) {
  return Object.freeze({ value: finite(value, 'px'), unit: 'px' });
}

// Copy the input so normalization never freezes a caller's own object.
function normalize_length(length: Length | NormalizedLength, path = 'length'): NormalizedLength {
  const { value, unit } = typeof length === 'number'
    ? { value: length, unit: 'fraction' as const }
    : length;

  finite(value, path);
  if (unit !== 'fraction' && unit !== 'em' && unit !== 'px') {
    throw new RangeError(`${path}: Unknown length unit: ${unit}`);
  }
  return Object.freeze({ value, unit });
}

// Intrinsic queries can retain the tagged dependency instead of guessing a size.
function measure_length(
  length: Length | NormalizedLength,
  basis: LengthBasis = {},
  path = 'length',
): number | NormalizedLength {
  const normalized = normalize_length(length, path);
  const { value, unit } = normalized;
  if (value === 0 || unit === 'px') return value;

  const reference = unit === 'em' ? basis.font_size : basis.fraction;
  if (reference === undefined) return normalized;
  nonnegative(reference, `${path} ${unit} reference`);
  return finite(value * reference, path);
}

// Final layout must resolve every length; include the source property in errors.
function resolve_length(
  length: Length | NormalizedLength,
  basis: LengthBasis = {},
  path = 'length',
): number {
  const result = measure_length(length, basis, path);
  if (typeof result === 'number') return result;
  throw new UnresolvedLengthError(result, path);
}

// Both relative forms of font_size refer to the inherited font size.
function resolve_font_size(
  length?: Length,
  inherited: number = DEFAULTS.font_size,
  path = 'font_size',
): number {
  nonnegative(inherited, 'inherited font_size');
  if (length === undefined) return inherited;
  const basis = { font_size: inherited, fraction: inherited };
  return nonnegative(resolve_length(length, basis, path), path);
}

// Line height and other em lengths use the newly resolved local font size.
function resolve_line_height(
  length: Length | NormalizedLength = em(DEFAULTS.line_height),
  font_size: number = DEFAULTS.font_size,
  path = 'line_height',
): number {
  nonnegative(font_size, 'font_size');
  const basis = { font_size, fraction: font_size };
  return nonnegative(resolve_length(length, basis, path), path);
}

class UnresolvedLengthError extends Error {
  readonly length: NormalizedLength;
  readonly path: string;

  constructor(length: NormalizedLength, path: string) {
    const reference = length.unit === 'em' ? 'font size' : 'fraction reference';
    super(`${path}: ${length.value} ${length.unit} requires a definite ${reference}`);
    this.name = 'UnresolvedLengthError';
    this.length = length;
    this.path = path;
  }
}

export {
  em, px, normalize_length, measure_length, resolve_length,
  resolve_font_size, resolve_line_height, UnresolvedLengthError,
};
export type {
  UnitLength, Length, NormalizedLength, LengthBasis, ReferenceBox, LengthContext,
};
