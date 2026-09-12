import { finite, nonnegative } from './checks';
import { Element, element_children } from './element';
import type { Child } from './element';
import { make_point, read_point } from './geometry';
import type { Point, PointValue, Size } from './geometry';
import { resolve_length } from './units';
import type { Length } from './units';

type Limit = readonly [number, number];
type DataBounds = Readonly<{ xlim?: Limit; ylim?: Limit }>;
type Coordinates = Readonly<{ xlim: Limit; ylim: Limit; flip_x: boolean; flip_y: boolean }>;
type CoordinateSpec = Readonly<{
  coord?: readonly [number, number, number, number];
  xlim?: Limit;
  ylim?: Limit;
  flip_x?: boolean;
  flip_y?: boolean;
  padding?: number | Readonly<{ x?: number; y?: number }>;
}>;
type GeometrySpace = 'local' | 'data';

// Limits are directed: descending endpoints reverse an axis independently of flips.
function copy_limit(limit: Limit, name = 'limit', allow_equal = false): Limit {
  if (limit.length !== 2) throw new TypeError(`${name} needs two endpoints`);
  const a = finite(limit[0], `${name}[0]`), b = finite(limit[1], `${name}[1]`);
  if (!allow_equal && a === b) throw new RangeError(`${name} endpoints must differ`);
  finite(b - a, `${name} span`);
  return Object.freeze([a, b]);
}

function copy_coordinates(coord: Coordinates): Coordinates {
  return Object.freeze({ xlim: copy_limit(coord.xlim, 'xlim'), ylim: copy_limit(coord.ylim, 'ylim'),
    flip_x: Boolean(coord.flip_x), flip_y: Boolean(coord.flip_y) });
}

// Missing and nonfinite samples never contaminate limits. Singleton data gets a
// useful finite interval; an explicitly degenerate limit is instead a mistake.
function point_bounds(points: readonly (PointValue | null)[]): DataBounds | null {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const value of points) {
    if (value === null) continue;
    const point = read_point(value);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    xmin = Math.min(xmin, point.x); xmax = Math.max(xmax, point.x);
    ymin = Math.min(ymin, point.y); ymax = Math.max(ymax, point.y);
  }
  return xmin === Infinity ? null : { xlim: [xmin, xmax], ylim: [ymin, ymax] };
}

function merge_bounds(bounds: readonly (DataBounds | null)[]): DataBounds | null {
  const result: { xlim?: Limit; ylim?: Limit } = {};
  for (const axis of ['xlim', 'ylim'] as const) {
    let low = Infinity, high = -Infinity;
    for (const item of bounds) {
      if (!item?.[axis]) continue;
      const [a, b] = copy_limit(item[axis], axis, true);
      low = Math.min(low, a, b); high = Math.max(high, a, b);
    }
    if (low !== Infinity) result[axis] = Object.freeze([low, high]);
  }
  return Object.keys(result).length ? Object.freeze(result) : null;
}

// An explicit capability is a boundary. Nested Graphs/Plots return null, while
// ordinary transparent composition can report the bounds of its descendants.
function data_bounds(element: Element): DataBounds | null {
  if (element.type.data_bounds) return element.type.data_bounds(element);
  function collect(child: Child): (DataBounds | null)[] {
    return child instanceof Element ? [data_bounds(child)]
      : Array.isArray(child) ? child.flatMap(collect) : [];
  }
  return merge_bounds(collect(element.props.children));
}

function infer_coordinates(children: Child, spec: CoordinateSpec = {}): Coordinates {
  const bounds = merge_bounds(element_children(children).map(data_bounds));
  if (spec.coord && spec.coord.length !== 4) throw new TypeError('coord needs [xmin, ymin, xmax, ymax]');
  function limits(axis: 'x' | 'y'): Limit {
    const key = axis === 'x' ? 'xlim' : 'ylim';
    const pair = spec[key] ?? (spec.coord
      ? [spec.coord[axis === 'x' ? 0 : 1], spec.coord[axis === 'x' ? 2 : 3]] as Limit : undefined);
    if (pair) return copy_limit(pair, key);
    let [a, b] = bounds?.[key] ?? [0, 1];
    if (a === b) {
      const radius = Math.max(0.5, Math.abs(a) * 0.05);
      a -= radius; b += radius;
    }
    const padding = typeof spec.padding === 'object' ? spec.padding[axis] ?? 0 : spec.padding ?? 0;
    const pad = nonnegative(padding, `padding.${axis}`) * (b - a);
    return copy_limit([a - pad, b + pad], key);
  }
  return copy_coordinates({ xlim: limits('x'), ylim: limits('y'),
    flip_x: spec.flip_x ?? false, flip_y: spec.flip_y ?? true });
}

function map_axis(value: number, limit: Limit, extent: number, flip = false): number {
  const fraction = (finite(value, 'coordinate') - limit[0]) / (limit[1] - limit[0]);
  return (flip ? 1 - fraction : fraction) * extent;
}

function map_point(value: PointValue, coord: Coordinates, size: Size): Point {
  const point = read_point(value);
  return make_point(map_axis(point.x, coord.xlim, size.width, coord.flip_x),
    map_axis(point.y, coord.ylim, size.height, coord.flip_y));
}

function unmap_point(value: PointValue, coord: Coordinates, size: Size): Point {
  const point = read_point(value);
  if (!size.width || !size.height) throw new RangeError('Cannot invert a zero-sized coordinate frame');
  const x = point.x / size.width, y = point.y / size.height;
  return make_point(coord.xlim[0] + (coord.flip_x ? 1 - x : x) * (coord.xlim[1] - coord.xlim[0]),
    coord.ylim[0] + (coord.flip_y ? 1 - y : y) * (coord.ylim[1] - coord.ylim[0]));
}

// Only numeric geometry participates in data mapping. px/em remain local lengths.
function coordinate_length(value: Length, axis: 'x' | 'y', size: Size, font_size: number,
  coord?: Coordinates, path = 'coordinate'): number {
  const extent = axis === 'x' ? size.width : size.height;
  if (coord && typeof value === 'number') {
    return map_axis(value, axis === 'x' ? coord.xlim : coord.ylim, extent,
      axis === 'x' ? coord.flip_x : coord.flip_y);
  }
  return resolve_length(value, { font_size, fraction: extent }, path);
}

export { copy_limit, copy_coordinates, point_bounds, merge_bounds, data_bounds,
  infer_coordinates, map_axis, map_point, unmap_point, coordinate_length };
export type { Limit, DataBounds, Coordinates, CoordinateSpec, GeometrySpace };
