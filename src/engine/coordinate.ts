import { freeze_owned } from '../lib/immutable'
import { finite } from '../lib/checks'
import type { PointValue } from './geometry'
import { normalize_length } from './units'
import type { Length } from './units'

// Source coordinates retain their dimension names until a projection interprets
// them. Resolved drawing geometry uses Point instead.
type Coordinate<T = number> = Readonly<Record<string, T>>
type CoordinateValue<T = number> = Coordinate<T> | readonly [x: T, y: T]
type CoordinatePosition = Coordinate | PointValue<Length>
type PositionRecord = Coordinate | Readonly<{ x: Length; y: Length }>

// Read representation without checking components: sample consumers need to
// retain nonfinite values until they can turn them into gaps.
function read_coordinate<T>(value: CoordinateValue<T>, name = 'coordinate'): Coordinate<T> {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length === 2 && Object.hasOwn(value, 0) && Object.hasOwn(value, 1)) {
        return freeze_owned({ x: value[0], y: value[1] })
      }
    } else {
      const proto = Object.getPrototypeOf(value)
      if ((proto === Object.prototype || proto === null) && Object.keys(value).length
        && !Object.getOwnPropertySymbols(value).length) {
        return freeze_owned({ ...value as Coordinate<T> })
      }
    }
  }
  throw new TypeError(`${name} needs a nonempty coordinate record or [x, y] pair`)
}

// Projection boundaries accept records only and own their immutable snapshots.
// Tuple shorthand is expanded by source-coordinate consumers before this call.
function copy_coordinate(value: Coordinate, name = 'coordinate'): Coordinate {
  if (Array.isArray(value)) throw new TypeError(`${name} needs a coordinate record`)
  const point = read_coordinate(value, name)
  for (const [key, component] of Object.entries(point)) {
    if (typeof component !== 'number') throw new TypeError(`${name}.${key} must be a number`)
    finite(component, `${name}.${key}`)
  }
  return point
}

// Axis arithmetic must never silently discard a source dimension.
function read_cartesian<T>(value: CoordinateValue<T>, name = 'point'): Readonly<{ x: T; y: T }> {
  const point = read_coordinate(value, name)
  if (Object.keys(point).length !== 2 || !Object.hasOwn(point, 'x') || !Object.hasOwn(point, 'y')) {
    throw new TypeError(`${name} needs Cartesian {x, y} or [x, y] with exactly two coordinates`)
  }
  return point as Readonly<{ x: T; y: T }>
}

// Source positions may contain lengths only in a Cartesian pair. Check their
// shape before filtering nonfinite numeric samples, so malformed data still fails.
function read_position(value: CoordinatePosition, name = 'position'): PositionRecord {
  const point = read_coordinate<Length>(value, name)
  if (Object.values(point).every(component => typeof component === 'number')) return point as Coordinate
  const pair = read_cartesian(point, name)
  const component = (value: Length, axis: string): Length => {
    if (typeof value === 'number') return value
    if (value === null || (typeof value !== 'string' && typeof value !== 'object')) {
      throw new TypeError(`${name}.${axis} must be a number or local length`)
    }
    normalize_length(value, `${name}.${axis}`)
    return typeof value === 'object' ? freeze_owned({ ...value }) : value
  }
  return freeze_owned({ x: component(pair.x, 'x'), y: component(pair.y, 'y') })
}

function finite_position(value: CoordinatePosition | null, name = 'point'): PositionRecord | null {
  if (value === null) return null
  const point = read_position(value, name)
  return Object.values(point).every(v => typeof v !== 'number' || Number.isFinite(v)) ? point : null
}

export { read_coordinate, copy_coordinate, read_cartesian, read_position, finite_position }
export type { Coordinate, CoordinateValue, CoordinatePosition }
