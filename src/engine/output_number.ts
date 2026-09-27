/** Maximum decimal places (0–100), or 'full' for unrounded number strings. */
type OutputPrecision = number | 'full'

const DEFAULT_OUTPUT_PRECISION = 10

// Round only the serialized representation; layout and fragment geometry stay exact.
function output_number_formatter(precision: OutputPrecision = DEFAULT_OUTPUT_PRECISION): (value: number) => string {
  if (precision !== 'full' && (!Number.isInteger(precision) || precision < 0 || precision > 100)) {
    throw new RangeError('precision must be an integer from 0 to 100, or "full"')
  }
  // A formatter belongs to one render. Repeated glyph coordinates are common,
  // while maps can contain mostly unique values; cap retained strings in either case.
  const cache = new Map<number, string>()
  let samples = 0, hits = 0, caching = true
  return value => {
    if (!Number.isFinite(value)) throw new RangeError('Output numbers must be finite')
    if (precision === 'full' || Number.isInteger(value)) return String(value)
    if (!caching) return String(Number(value.toFixed(precision)))
    const cached = cache.get(value)
    // Stop paying for a lookup on paths whose first fractional coordinates
    // rarely repeat. Sampling ends after 512 calls and excludes integer values.
    if (samples < 512) {
      samples++
      if (cached !== undefined) hits++
      if (samples === 512 && hits < 64) {
        caching = false
        cache.clear()
      }
    }
    if (cached !== undefined) return cached
    const formatted = String(Number(value.toFixed(precision)))
    if (caching && cache.size < 4096) cache.set(value, formatted)
    return formatted
  }
}

export { DEFAULT_OUTPUT_PRECISION, output_number_formatter }
export type { OutputPrecision }
