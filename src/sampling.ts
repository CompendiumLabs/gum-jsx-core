import { finite } from './checks';
import { copy_limit } from './coordinates';
import type { Limit } from './coordinates';
import { make_point } from './geometry';
import type { Point } from './geometry';

type PointValue = Point | readonly [number, number];
type ScalarFunction = number | ((value: number) => number);
type SampleProps = Readonly<{
  f?: (value: number) => PointValue | null;
  fx?: ScalarFunction; fy?: ScalarFunction;
  xlim?: Limit; ylim?: Limit; tlim?: Limit;
  xvals?: readonly number[]; yvals?: readonly number[]; tvals?: readonly number[];
  samples?: number;
}>;
type Sample = Readonly<{ t: number; point: Point | null }>;

function sample_count(count: number, max = 100000): number {
  if (!Number.isInteger(count) || count < 0 || count > max) {
    throw new RangeError(`samples must be an integer from 0 to ${max}`);
  }
  return count;
}

function linspace(start: number, end: number, count = 101): readonly number[] {
  finite(start, 'start'); finite(end, 'end'); sample_count(count);
  return Object.freeze(Array.from({ length: count }, (_, i) => count < 2 ? start
    : i === count - 1 ? end : start + (end - start) * i / (count - 1)));
}

function finite_point(value: PointValue | null): Point | null {
  if (value === null) return null;
  if (typeof value !== 'object' || (Array.isArray(value) && value.length !== 2)) {
    throw new TypeError('A sample must be {x,y}, [x,y], or null');
  }
  const x = 'x' in value ? value.x : value[0], y = 'y' in value ? value.y : value[1];
  return Number.isFinite(x) && Number.isFinite(y) ? make_point(x, y) : null;
}

function scalar_value(fn: ScalarFunction, value: number): number {
  return typeof fn === 'function' ? fn(value) : fn;
}

// Explicit arrays determine count. Sampling preserves indices and null gaps;
// no renderer or layout request ever reexecutes a user callback.
function sample_curve(props: SampleProps = {}): readonly Sample[] {
  const { f, fx, fy, xvals, yvals, tvals } = props;
  const counts = [xvals, yvals, tvals].filter(values => values !== undefined).map(values => values.length);
  if (new Set(counts).size > 1) throw new RangeError('Sample arrays must have matching lengths');
  sample_count(props.samples ?? 101);
  const count = sample_count(counts[0] ?? props.samples ?? 101);
  if (f && (fx !== undefined || fy !== undefined || xvals || yvals)) {
    throw new TypeError('Use either parametric f or separate x/y inputs');
  }
  if ((fx !== undefined && xvals) || (fy !== undefined && yvals)) {
    throw new TypeError('Provide each coordinate as either explicit values or a function');
  }
  const range = (lim: Limit = [0, 1]) => {
    const [a, b] = copy_limit(lim, 'sample limit', true);
    return linspace(a, b, count);
  };
  const ts = tvals ?? range(props.tlim);
  const xs = xvals ?? range(props.xlim), ys = yvals ?? range(props.ylim);
  if (!f && fx === undefined && fy === undefined && !xvals && !yvals && !props.xlim && !props.ylim) {
    return Object.freeze([]);
  }
  return Object.freeze(ts.map((t, index) => {
    if (!Number.isFinite(t)) return Object.freeze({ t, point: null });
    let point: PointValue | null;
    try {
      if (f) point = f(t);
      else if (fx !== undefined && fy !== undefined) point = { x: scalar_value(fx, t), y: scalar_value(fy, t) };
      else if (fy !== undefined) {
        const x = xvals ? xvals[index] : tvals || props.tlim ? t : xs[index];
        point = { x, y: scalar_value(fy, x) };
      } else if (fx !== undefined) {
        const y = yvals ? yvals[index] : tvals || props.tlim ? t : ys[index];
        point = { x: scalar_value(fx, y), y };
      } else point = { x: xs[index], y: ys[index] };
      return Object.freeze({ t, point: finite_point(point) });
    } catch (cause) {
      throw new Error(`Sample ${index} at t=${t} failed`, { cause });
    }
  }));
}

function sample_points(props: SampleProps = {}): readonly (Point | null)[] {
  return Object.freeze(sample_curve(props).map(sample => sample.point));
}

export { linspace, sample_curve, sample_points, sample_count, finite_point, scalar_value };
export type { PointValue, ScalarFunction, SampleProps, Sample };
