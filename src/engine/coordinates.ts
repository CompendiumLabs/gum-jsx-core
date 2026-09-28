import { freeze_owned } from '../lib/immutable'
import { finite, nonnegative } from '../lib/checks'
import { Element, element_children } from './element'
import type { Child } from './element'
import { make_point, read_point, read_insets } from './geometry'
import type { Point, PointValue, Size, InsetSpec } from './geometry'
import { resolve_length } from './units'
import type { Length, LengthContext } from './units'
import { read_coordinate, copy_coordinate, finite_position } from './coordinate'
import type { Coordinate, CoordinateValue, CoordinatePosition } from './coordinate'
import { Projection } from './projection'

type Limit = readonly [number, number]
type DataBounds = Readonly<{ xlim?: Limit; ylim?: Limit }>
type Coordinates = Readonly<{
  xlim: Limit; ylim: Limit; flip_x: boolean; flip_y: boolean; projection?: Projection
}>
type CoordinateSpec = Readonly<{
  coord?: readonly [number, number, number, number]
  xlim?: Limit
  ylim?: Limit
  flip_x?: boolean
  flip_y?: boolean
  padding?: InsetSpec<number> | Readonly<{ x?: number; y?: number }>
}>
type GeometrySpace = 'local' | 'data'

// Limits are directed: descending endpoints reverse an axis independently of flips.
function copy_limit(limit: Limit, name = 'limit', allow_equal = false): Limit {
  if (limit.length !== 2) throw new TypeError(`${name} needs two endpoints`)
  const a = finite(limit[0], `${name}[0]`), b = finite(limit[1], `${name}[1]`)
  if (!allow_equal && a === b) throw new RangeError(`${name} endpoints must differ`)
  finite(b - a, `${name} span`)
  return freeze_owned([a, b])
}

function copy_coordinates(coord: Coordinates): Coordinates {
  if (coord.projection !== undefined && !(coord.projection instanceof Projection)) {
    throw new TypeError('Coordinates projection must be a Projection')
  }
  return freeze_owned({ xlim: copy_limit(coord.xlim, 'xlim'), ylim: copy_limit(coord.ylim, 'ylim'),
    flip_x: Boolean(coord.flip_x), flip_y: Boolean(coord.flip_y),
    ...(coord.projection ? { projection: coord.projection } : {}) })
}

// Missing and nonfinite samples never contaminate limits. Singleton data gets a
// useful finite interval; an explicitly degenerate limit is instead a mistake.
function point_bounds(points: readonly (PointValue | null)[]): DataBounds | null {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity
  for (const value of points) {
    if (value === null) continue
    const point = read_point(value)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
    xmin = Math.min(xmin, point.x); xmax = Math.max(xmax, point.x)
    ymin = Math.min(ymin, point.y); ymax = Math.max(ymax, point.y)
  }
  return xmin === Infinity ? null : { xlim: [xmin, xmax], ylim: [ymin, ymax] }
}

// Inferred bounds belong to Cartesian source space. Explicit projected limits
// bypass discovery; no bounds reader should interpret arbitrary dimension names.
function position_bounds(points: readonly (CoordinatePosition | null)[]): DataBounds | null {
  return point_bounds(points.map(value => {
    const point = finite_position(value)
    if (point === null) return null
    if (!Object.hasOwn(point, 'x') || !Object.hasOwn(point, 'y')) {
      throw new TypeError('Data coordinates need x and y; named coordinates require a projection with explicit limits')
    }
    return typeof point.x === 'number' && typeof point.y === 'number' ? { x: point.x, y: point.y } : null
  }))
}

function merge_bounds(bounds: readonly (DataBounds | null)[]): DataBounds | null {
  const result: { xlim?: Limit; ylim?: Limit } = {}
  for (const axis of ['xlim', 'ylim'] as const) {
    let low = Infinity, high = -Infinity
    for (const item of bounds) {
      if (!item?.[axis]) continue
      const [a, b] = copy_limit(item[axis], axis, true)
      low = Math.min(low, a, b); high = Math.max(high, a, b)
    }
    if (low !== Infinity) result[axis] = freeze_owned([low, high])
  }
  return Object.keys(result).length ? freeze_owned(result) : null
}

// An explicit capability is a boundary. Nested Graphs/Plots return null, while
// ordinary transparent composition can report the bounds of its descendants.
function data_bounds(element: Element): DataBounds | null {
  if (element.type.data_bounds) return element.type.data_bounds(element)
  function collect(child: Child): (DataBounds | null)[] {
    return child instanceof Element ? [data_bounds(child)]
      : Array.isArray(child) ? child.flatMap(collect) : []
  }
  return merge_bounds(collect(element.props.children))
}

function infer_coordinates(children: Child, spec: CoordinateSpec = {},
  extra: readonly (DataBounds | null)[] = []): Coordinates {
  if (spec.coord && spec.coord.length !== 4) throw new TypeError('coord needs [xmin, ymin, xmax, ymax]')
  // Complete limits need no source-bound discovery. In particular, projected
  // annotations may use dimension names that Cartesian bounds cannot interpret.
  const bounds = spec.coord || (spec.xlim && spec.ylim) ? null
    : merge_bounds([...element_children(children).map(data_bounds), ...extra])
  const raw = spec.padding ?? 0
  // Retain the original axis-object form as an alias for horizontal/vertical.
  const padding = read_insets(typeof raw === 'object' && !Array.isArray(raw) && ('x' in raw || 'y' in raw)
    ? { h: 'x' in raw ? raw.x : undefined, v: 'y' in raw ? raw.y : undefined, ...raw } : raw as InsetSpec<number>)
  function limits(axis: 'x' | 'y'): Limit {
    const key = axis === 'x' ? 'xlim' : 'ylim'
    const pair = spec[key] ?? (spec.coord
      ? [spec.coord[axis === 'x' ? 0 : 1], spec.coord[axis === 'x' ? 2 : 3]] as Limit : undefined)
    if (pair) return copy_limit(pair, key)
    let [a, b] = bounds?.[key] ?? [0, 1]
    if (a === b) {
      const radius = Math.max(0.5, Math.abs(a) * 0.05)
      a -= radius; b += radius
    }
    const flipped = axis === 'x' ? spec.flip_x ?? false : spec.flip_y ?? true
    const sides = axis === 'x' ? ['left', 'right'] as const : ['top', 'bottom'] as const
    const [low, high] = flipped ? [sides[1], sides[0]] : sides
    const span = b - a
    return copy_limit([a - nonnegative(padding[low] ?? 0, `padding.${low}`) * span,
      b + nonnegative(padding[high] ?? 0, `padding.${high}`) * span], key)
  }
  return copy_coordinates({ xlim: limits('x'), ylim: limits('y'),
    flip_x: spec.flip_x ?? false, flip_y: spec.flip_y ?? true })
}

function map_axis(value: number, limit: Limit, extent: number, flip = false): number {
  const fraction = (finite(value, 'coordinate') - limit[0]) / (limit[1] - limit[0])
  return (flip ? 1 - fraction : fraction) * extent
}

function map_point(value: CoordinateValue, coord: Coordinates, size: Size): Point | null {
  const source = read_coordinate(value)
  const point = coord.projection ? coord.projection.project(source) : copy_coordinate(source)
  if (point === null) return null
  if (!Object.hasOwn(point, 'x') || !Object.hasOwn(point, 'y')) {
    throw new TypeError(coord.projection
      ? 'Projection output needs x and y for Cartesian mapping'
      : 'Data coordinates need x and y; named coordinates require a projection')
  }
  return make_point(map_axis(point.x, coord.xlim, size.width, coord.flip_x),
    map_axis(point.y, coord.ylim, size.height, coord.flip_y))
}

function unmap_point(value: PointValue, coord: Coordinates, size: Size): Point {
  if (coord.projection) throw new TypeError('Custom projections do not provide an inverse')
  const point = read_point(value)
  if (!size.width || !size.height) throw new RangeError('Cannot invert a zero-sized coordinate frame')
  const x = point.x / size.width, y = point.y / size.height
  return make_point(coord.xlim[0] + (coord.flip_x ? 1 - x : x) * (coord.xlim[1] - coord.xlim[0]),
    coord.ylim[0] + (coord.flip_y ? 1 - y : y) * (coord.ylim[1] - coord.ylim[0]))
}

// Only numeric geometry participates in data mapping. Tagged units remain lengths.
function coordinate_length(value: Length, axis: 'x' | 'y', size: Size, measure: LengthContext,
  coord?: Coordinates, property: string = axis): number {
  const extent = axis === 'x' ? size.width : size.height
  if (coord && typeof value === 'number') {
    if (coord.projection) throw new TypeError('A projection needs a coordinate record; use coordinate_point')
    return map_axis(value, axis === 'x' ? coord.xlim : coord.ylim, extent,
      axis === 'x' ? coord.flip_x : coord.flip_y)
  }
  return resolve_length(value, measure, extent, property)
}

// Data mapping consumes the complete record. Only local Cartesian lengths can
// bypass it; mixing data components and lengths is ambiguous under projection.
function coordinate_point(value: CoordinatePosition, size: Size, measure: LengthContext,
  coord?: Coordinates, property = 'position'): Point | null {
  const path = measure.path ? `${measure.path}.${property}` : property
  const point = read_coordinate<Length>(value, path)
  if (coord && Object.values(point).every(component => typeof component === 'number')) {
    return map_point(point as Coordinate, coord, size)
  }
  if (Object.keys(point).length !== 2 || !Object.hasOwn(point, 'x') || !Object.hasOwn(point, 'y')) {
    throw new TypeError(`${path}: Local positions need exactly x and y; named data coordinates require a projection and numeric components`)
  }
  if (point.x == null || point.y == null) throw new TypeError(`${path} needs both x and y components`)
  const numeric_x = typeof point.x === 'number', numeric_y = typeof point.y === 'number'
  if (coord?.projection && (numeric_x || numeric_y)) {
    throw new TypeError('Projected points need numeric data coordinates or two local lengths')
  }
  return make_point(coordinate_length(point.x, 'x', size, measure, coord, `${property}.x`),
    coordinate_length(point.y, 'y', size, measure, coord, `${property}.y`))
}

export { copy_limit, copy_coordinates, point_bounds, position_bounds, merge_bounds, data_bounds,
  infer_coordinates, map_axis, map_point, unmap_point, coordinate_length, coordinate_point }
export type { Limit, DataBounds, Coordinates, CoordinateSpec, GeometrySpace }
