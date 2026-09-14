import { finite, nonnegative } from './checks';
import { lerp } from './math';

const DEFAULT_SEED = 42;

// Mulberry32, with a cached Marsaglia polar normal sample. Each evaluated JSX
// document owns a stream; layout and SVG identifiers never draw from it.
class RNG {
  private state = 0;
  private spare: number | undefined;

  constructor(seed = DEFAULT_SEED) { this.setSeed(seed); }

  setSeed = (seed: number): this => {
    if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer');
    this.state = seed >>> 0;
    this.spare = undefined;
    return this;
  };

  random = (): number => {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  uniform = (lo = 0, hi = 1): number => {
    finite(lo, 'uniform lower bound'); finite(hi, 'uniform upper bound');
    if (hi <= lo) throw new RangeError('uniform upper bound must exceed its lower bound');
    return lerp(lo, hi, this.random());
  };

  normal = (mean = 0, stddev = 1): number => {
    finite(mean, 'normal mean'); nonnegative(stddev, 'normal standard deviation');
    if (stddev === 0) return mean;
    if (this.spare !== undefined) {
      const value = this.spare;
      this.spare = undefined;
      return mean + stddev * value;
    }
    let x = 0, y = 0, radius = 0;
    while (radius === 0 || radius >= 1) {
      x = this.uniform(-1, 1); y = this.uniform(-1, 1);
      radius = x * x + y * y;
    }
    const scale = Math.sqrt(-2 * Math.log(radius) / radius);
    this.spare = y * scale;
    return mean + stddev * x * scale;
  };

  integer = (lo: number, hi?: number): number => {
    const [start, end] = hi === undefined ? [0, lo] : [lo, hi];
    if (![start, end, end - start].every(Number.isSafeInteger)) {
      throw new RangeError('integer bounds and their difference must be safe integers');
    }
    if (end <= start) throw new RangeError('integer upper bound must exceed its lower bound');
    return start + Math.floor(this.random() * (end - start));
  };
}

// Direct imports share this stream. evaluate() creates its own independent RNG.
const defaults = new RNG();
const setSeed = (seed: number): void => { defaults.setSeed(seed); };
const { random, uniform, normal, integer } = defaults;

export { RNG, DEFAULT_SEED, setSeed, random, uniform, normal, integer };
