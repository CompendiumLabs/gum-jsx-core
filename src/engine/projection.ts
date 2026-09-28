import { freeze_owned } from '../lib/immutable'
import { copy_coordinate } from './coordinate'
import type { Coordinate } from './coordinate'

type ProjectionFunction = (point: Coordinate) => Coordinate | null

// Projection behavior is retained by identity, like an element type. Callbacks
// must be pure: changing captured state would invalidate layout-cache assumptions.
class Projection {
  #project: ProjectionFunction

  constructor(project: ProjectionFunction) {
    if (typeof project !== 'function') throw new TypeError('Projection needs a coordinate-record function')
    this.#project = project
    freeze_owned(this)
  }

  project(point: Coordinate): Coordinate | null {
    const result = this.#project(copy_coordinate(point, 'projection input'))
    if (result === null) return null
    return copy_coordinate(result, 'projection output')
  }
}

const identities = new WeakMap<Projection, number>()
let next_identity = 0
function projection_key(projection?: Projection): number | undefined {
  if (!projection) return undefined
  let identity = identities.get(projection)
  if (identity === undefined) identities.set(projection, identity = ++next_identity)
  return identity
}

export { Projection, projection_key }
export type { ProjectionFunction }
