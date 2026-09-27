import { finite } from './checks'
import { copy_coordinate } from '../engine/coordinate'
import type { Coordinate } from '../engine/coordinate'
import { Projection } from '../engine/projection'

type Point3 = Readonly<{ x: number; y: number; z: number }>
type OrthographicProjectionOptions = Readonly<{
  azimuth?: number
  elevation?: number
}>
type PerspectiveProjectionOptions = Readonly<{
  eye: Point3
  target?: Point3
  up?: Point3
  focal_length?: number
  near?: number
}>

// Projection validates numeric components; the 3D helpers additionally require
// their three named dimensions. Extra finite dimensions remain valid source data.
function require_xyz(point: Coordinate, name: string): Point3 {
  if (!['x', 'y', 'z'].every(axis => Object.hasOwn(point, axis))) {
    throw new TypeError(`${name} needs x, y, and z coordinates`)
  }
  return point as Point3
}

function point3(value: Point3, name: string): Point3 {
  return require_xyz(copy_coordinate(value, name), name)
}

function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Point3, b: Point3): Point3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function unit_vector(vector: Point3, name: string): Point3 {
  const scale = finite(Math.max(Math.abs(vector.x), Math.abs(vector.y), Math.abs(vector.z)), name)
  if (scale === 0) throw new RangeError(`${name} must be nonzero`)
  const x = vector.x / scale, y = vector.y / scale, z = vector.z / scale
  const length = Math.hypot(x, y, z)
  return { x: x / length, y: y / length, z: z / length }
}

// A right-handed viewing frame: forward points from the camera into the scene,
// and right × forward points up the page before Graph's viewport mapping.
function camera_basis(forward: Point3, right: Point3) {
  return { forward, right, up: cross(right, forward) }
}

function positive(value: number, name: string): number {
  if (finite(value, name) <= 0) throw new RangeError(`${name} must be positive`)
  return value
}

/** Fixed isometric view with unit projected axes, matching the helix example. */
function isometric_projection(): Projection {
  const horizontal = Math.sqrt(3) / 2
  return new Projection(point => {
    const { x, y, z } = require_xyz(point, 'isometric projection input')
    return { x: (x - y) * horizontal, y: z - (x + y) / 2 }
  })
}

/** Direction of sight in degrees: azimuth from +x toward +y, elevation toward +z. */
function orthographic_projection({ azimuth = 45, elevation = 30 }: OrthographicProjectionOptions = {}): Projection {
  const az = (finite(azimuth, 'azimuth') % 360) * Math.PI / 180
  finite(elevation, 'elevation')
  if (elevation < -90 || elevation > 90) throw new RangeError('elevation must be between -90 and 90 degrees')
  const el = elevation * Math.PI / 180
  const sin_az = Math.sin(az), cos_az = Math.cos(az), sin_el = Math.sin(el), cos_el = Math.cos(el)
  // Retain azimuth at the poles, where crossing the sight direction with z-up
  // would lose the horizontal orientation.
  const camera = camera_basis(
    { x: cos_el * cos_az, y: cos_el * sin_az, z: sin_el },
    { x: sin_az, y: -cos_az, z: 0 },
  )
  return new Projection(point => {
    const source = require_xyz(point, 'orthographic projection input')
    return { x: dot(source, camera.right), y: dot(source, camera.up) }
  })
}

/** Perspective coordinates on a plane focal_length units in front of the eye. */
function perspective_projection({ eye, target = { x: 0, y: 0, z: 0 }, up = { x: 0, y: 0, z: 1 },
  focal_length = 1, near = 0.01 }: PerspectiveProjectionOptions): Projection {
  const origin = point3(eye, 'eye'), aim = point3(target, 'target')
  const forward = unit_vector(subtract(aim, origin), 'target - eye')
  const vertical = unit_vector(point3(up, 'up'), 'up')
  const horizontal = cross(forward, vertical)
  if (Math.hypot(horizontal.x, horizontal.y, horizontal.z) <= 1e-12) {
    throw new RangeError('up must not be parallel to the viewing direction; choose another up vector')
  }
  const camera = camera_basis(forward, unit_vector(horizontal, 'camera right'))
  const focal = positive(focal_length, 'focal_length'), cutoff = positive(near, 'near')
  return new Projection(point => {
    const relative = subtract(require_xyz(point, 'perspective projection input'), origin)
    const depth = finite(dot(relative, camera.forward), 'camera depth')
    if (depth <= cutoff) return null
    return { x: focal * (dot(relative, camera.right) / depth), y: focal * (dot(relative, camera.up) / depth) }
  })
}

export { isometric_projection, orthographic_projection, perspective_projection }
export type { Point3, OrthographicProjectionOptions, PerspectiveProjectionOptions }
