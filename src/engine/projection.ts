import { finite } from '../lib/checks'

type PointPair = readonly [number, number]
type ProjectionFunction = (point: PointPair) => PointPair | null

// Projection behavior is retained by identity, like an element type. Callbacks
// must be pure: changing captured state would invalidate layout-cache assumptions.
class Projection {
  #project: ProjectionFunction

  constructor(project: ProjectionFunction) {
    if (typeof project !== 'function') throw new TypeError('Projection needs a point-pair function')
    this.#project = project
    Object.freeze(this)
  }

  project(point: PointPair): PointPair | null {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new TypeError('Projection input must be a coordinate pair')
    }
    const result = this.#project(Object.freeze([
      finite(point[0], 'projection input x'), finite(point[1], 'projection input y'),
    ]))
    if (result === null) return null
    if (!Array.isArray(result) || result.length !== 2) {
      throw new TypeError('Projection must return a coordinate pair or null')
    }
    return Object.freeze([
      finite(result[0], 'projection output x'), finite(result[1], 'projection output y'),
    ])
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
export type { PointPair, ProjectionFunction }
