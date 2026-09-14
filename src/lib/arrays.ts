import { count_limit, finite } from './checks';
import { lerp } from './math';
import type { Limit } from '../engine/coordinates';
import { read_point } from '../engine/geometry';
import type { Point, PointValue } from '../engine/geometry';

// Stop is excluded; a step pointing away from it produces an empty sequence.
function range(stop: number): readonly number[];
function range(start: number, stop: number, step?: number): readonly number[];
function range(start: number, stop?: number, step = 1): readonly number[] {
  if (stop === undefined) { stop = start; start = 0; }
  finite(start, 'range start'); finite(stop, 'range stop'); finite(step, 'range step');
  if (step === 0) throw new RangeError('range step must be nonzero');
  const distance = stop - start;
  const count = count_limit(Math.max(0, Math.ceil(Number.isFinite(distance)
    ? distance / step : stop / step - start / step)), 'range length');
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * step;
    const value = Number.isFinite(offset) ? start + offset : (start / i + step) * i;
    finite(value, 'range value');
    if (step > 0 ? value >= stop : value <= stop) break;
    if (i && value === result[i - 1]) throw new RangeError('range step is too small to advance');
    result.push(value);
  }
  return Object.freeze(result);
}

function linspace(start: number, end: number, count = 101, endpoint = true): readonly number[] {
  finite(start, 'linspace start'); finite(end, 'linspace end'); count_limit(count, 'linspace count');
  return Object.freeze(Array.from({ length: count }, (_, i) => count < 2 ? start
    : lerp(start, end, i / (endpoint ? count - 1 : count))));
}

function enumerate<T>(values: readonly T[]): readonly (readonly [number, T])[] {
  return Object.freeze(values.map((value, i) => Object.freeze([i, value] as const)));
}
function repeat<T>(value: T, count: number): readonly T[] {
  return Object.freeze(Array(count_limit(count, 'repeat count')).fill(value));
}

type ZipArgs = readonly (readonly unknown[])[];
type ZipRow<T extends ZipArgs> = { readonly [K in keyof T]: T[K][number] };
function zip<T extends ZipArgs>(...arrays: T): readonly ZipRow<T>[] {
  const length = arrays.length ? arrays.reduce((n, values) => Math.min(n, values.length), Infinity) : 0;
  count_limit(length, 'zip length');
  return Object.freeze(Array.from({ length }, (_, i) => Object.freeze(arrays.map(values => values[i])) as ZipRow<T>));
}
function meshgrid<X, Y>(xs: readonly X[], ys: readonly Y[]): readonly (readonly [X, Y])[] {
  count_limit(xs.length * ys.length, 'meshgrid size');
  return Object.freeze(xs.flatMap(x => ys.map(y => Object.freeze([x, y] as const))));
}
function lingrid(xlim: Limit, ylim: Limit, counts: number | PointValue = 11): readonly Point[] {
  const { x: nx, y: ny } = typeof counts === 'number' ? { x: counts, y: counts }
    : read_point(counts, 'grid counts');
  count_limit(nx, 'grid x count'); count_limit(ny, 'grid y count'); count_limit(nx * ny, 'grid size');
  if (xlim.length !== 2 || ylim.length !== 2) throw new TypeError('grid limits must contain two numbers');
  return Object.freeze(meshgrid(linspace(...xlim, nx), linspace(...ylim, ny))
    .map(([x, y]) => Object.freeze({ x, y })));
}
function reshape<T>(values: readonly T[], shape: readonly [number, number]): readonly (readonly T[])[] {
  if (shape.length !== 2) throw new TypeError('reshape needs [rows, columns]');
  const [rows, columns] = shape;
  count_limit(rows, 'rows'); count_limit(columns, 'columns'); count_limit(rows * columns, 'reshape size');
  if (rows * columns !== values.length) throw new RangeError('reshape size must match the input length');
  return Object.freeze(Array.from({ length: rows }, (_, i) => Object.freeze(values.slice(i * columns, (i + 1) * columns))));
}
function split<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  count_limit(size, 'split size');
  if (size === 0) throw new RangeError('split size must be positive');
  return Object.freeze(range(Math.ceil(values.length / size)).map(i => Object.freeze(values.slice(i * size, (i + 1) * size))));
}
function concat<T>(arrays: readonly (readonly T[])[]): readonly T[] {
  count_limit(arrays.reduce((n, values) => n + values.length, 0), 'concat length');
  return Object.freeze(arrays.flat());
}
function slice<T>(values: readonly T[], start?: number, stop?: number, step = 1): readonly T[] {
  for (const [name, value] of [['start', start], ['stop', stop], ['step', step]] as const) {
    if (value !== undefined && !Number.isSafeInteger(value)) throw new RangeError(`slice ${name} must be an integer`);
  }
  if (step === 0) throw new RangeError('slice step must be nonzero');
  const n = values.length, forward = step > 0;
  const bound = (i: number) => Math.max(forward ? 0 : -1, Math.min(i < 0 ? n + i : i, forward ? n : n - 1));
  const a = start === undefined ? (forward ? 0 : n - 1) : bound(start);
  const b = stop === undefined ? (forward ? n : -1) : bound(stop);
  return Object.freeze(range(a, b, step).map(i => values[i]));
}

export { range, linspace, enumerate, repeat, meshgrid, lingrid, zip, reshape, split, concat, slice };
export type { ZipArgs, ZipRow };
