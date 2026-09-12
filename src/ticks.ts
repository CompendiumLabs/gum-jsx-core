import { finite, nonnegative } from './checks';
import { copy_limit } from './coordinates';
import type { Limit } from './coordinates';

// Tick generation is independent of layout. Counts are targets; 1/2/5 intervals
// produce readable linear scales without rounding the underlying data domain.
function linear_ticks(limit: Limit, count = 5, interval?: number): readonly number[] {
  const [a, b] = copy_limit(limit);
  nonnegative(count, 'tick count');
  if (!Number.isInteger(count) || count > 10000) throw new RangeError('Tick count must be an integer up to 10000');
  if (!count) return Object.freeze([]);
  if (count === 1 && interval === undefined) return Object.freeze([a + (b - a) / 2]);
  const low = Math.min(a, b), high = Math.max(a, b);
  let step = interval;
  if (step === undefined) {
    const raw = (high - low) / Math.max(1, count - 1);
    const power = 10 ** Math.floor(Math.log10(raw)), error = raw / power;
    step = power * (error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1);
  }
  if (finite(step, 'tick interval') <= 0) throw new RangeError('Tick interval must be positive');
  const epsilon = 1e-10;
  const start = Math.ceil(low / step - epsilon), end = Math.floor(high / step + epsilon);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end - start > 10000) {
    throw new RangeError('Tick interval produces too many ticks or exceeds numeric precision');
  }
  const result = Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => {
    const value = Number(((start + i) * step).toPrecision(14));
    return Object.is(value, -0) ? 0 : value;
  });
  return Object.freeze(a > b ? result.reverse() : result);
}

function format_tick(value: number): string {
  finite(value, 'tick');
  const clean = Number(value.toPrecision(12));
  return Object.is(clean, -0) ? '0' : String(clean);
}

export { linear_ticks, format_tick };
