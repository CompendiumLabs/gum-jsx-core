/** Maximum decimal places (0–100), or 'full' for unrounded number strings. */
type OutputPrecision = number | 'full'

const DEFAULT_OUTPUT_PRECISION = 10

// Round only the serialized representation; layout and fragment geometry stay exact.
function output_number_formatter(precision: OutputPrecision = DEFAULT_OUTPUT_PRECISION): (value: number) => string {
  if (precision !== 'full' && (!Number.isInteger(precision) || precision < 0 || precision > 100)) {
    throw new RangeError('precision must be an integer from 0 to 100, or "full"')
  }
  return value => {
    if (!Number.isFinite(value)) throw new RangeError('Output numbers must be finite')
    if (value === 0) return '0'
    return precision === 'full' ? String(value) : String(Number(value.toFixed(precision)))
  }
}

export { DEFAULT_OUTPUT_PRECISION, output_number_formatter }
export type { OutputPrecision }
