import { finite } from './checks'
import type { Connection, Placement } from '../engine/fragment'
import { make_point, make_transform } from '../engine/geometry'
import type { Clip, Point, Transform } from '../engine/geometry'
import type { Side } from '../elems/placement'

type PlacedConnection = Readonly<Connection & { transform: Transform }>
type Port = Readonly<{ point: Point; normal: Point }>
const identity: Transform = [1, 0, 0, 1, 0, 0]

function transform_point(p: Point, [a, b, c, d, e, f]: Transform): Point {
  return make_point(a * p.x + c * p.y + e, b * p.x + d * p.y + f)
}

// Compose the actual placement matrices, preserving rotations and shears instead
// of replacing a node's outline with its axis-aligned bounding rectangle.
function placement_transform(parent: Transform, placement: Placement): Transform {
  const [a, b, c, d, e, f] = parent
  const [g, h, i, j, k, l] = placement.transform ?? identity
  const x = k + placement.offset.x, y = l + placement.offset.y
  return make_transform([a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * x + c * y + e, b * x + d * y + f])
}

function collect_connections(children: readonly Placement[]): ReadonlyMap<string, PlacedConnection> {
  const nodes = new Map<string, PlacedConnection>()
  function visit(placement: Placement, parent: Transform) {
    const { fragment } = placement
    if (fragment.connection_scope) return
    const transform = placement_transform(parent, placement)
    if (fragment.connection) {
      const { id } = fragment.connection
      if (nodes.has(id)) throw new TypeError(`Duplicate node id: ${id}`)
      nodes.set(id, { ...fragment.connection, transform })
      return
    }
    for (const child of fragment.children) visit(child, transform)
  }
  for (const child of children) visit(child, identity)
  return nodes
}

function connection_center(node: PlacedConnection): Point {
  const { x, y, width, height } = node.boundary
  return transform_point(make_point(x + width / 2, y + height / 2), node.transform)
}

// Select a side in the node's own coordinates, even on a rotated or flipped node.
function connection_side(node: PlacedConnection, toward: Point): Side {
  const [a, b, c, d, e, f] = node.transform, det = a * d - b * c
  if (!det) throw new RangeError(`Cannot attach to node ${node.id} through a singular transform`)
  const { x, y, width, height } = node.boundary
  const dx = (d * (toward.x - e) - c * (toward.y - f)) / det - x - width / 2
  const dy = (a * (toward.y - f) - b * (toward.x - e)) / det - y - height / 2
  return Math.abs(dx) * height >= Math.abs(dy) * width
    ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'top' : 'bottom'
}

// A side's location runs left-to-right or top-to-bottom. Near rounded corners,
// project onto the same ellipse used to draw the frame and use its outward normal.
function boundary_port(rect: Clip, side: Side, loc: number): Port {
  const horizontal = side === 'top' || side === 'bottom'
  const low = side === 'top' || side === 'left', sign = low ? -1 : 1
  const along = (horizontal ? rect.width : rect.height) * loc
  const across = low ? 0 : horizontal ? rect.height : rect.width
  const point = horizontal ? make_point(along, across) : make_point(across, along)
  let normal = horizontal ? make_point(0, sign) : make_point(sign, 0)
  const radius = rect.radius
  const corners = radius && ('tl' in radius ? radius : { tl: radius, tr: radius, bl: radius, br: radius })
  const keys = horizontal ? low ? ['tl', 'tr'] as const : ['bl', 'br'] as const
    : low ? ['tl', 'bl'] as const : ['tr', 'br'] as const
  let px = point.x, py = point.y
  if (corners) {
    for (let i = 0; i < 2; i++) {
      const { x: rx, y: ry } = corners[keys[i]]
      const ra = horizontal ? rx : ry, rb = horizontal ? ry : rx
      const extent = horizontal ? rect.width : rect.height
      if (!ra || !rb || (i === 0 ? along >= ra : along <= extent - ra)) continue
      const ca = i === 0 ? ra : extent - ra, cb = across - sign * rb
      const u = (along - ca) / ra, v = sign * Math.sqrt(Math.max(0, 1 - u * u))
      const cross = cb + rb * v
      if (horizontal) { py = cross; normal = make_point(u / ra, v / rb); }
      else { px = cross; normal = make_point(v / rb, u / ra); }
    }
  }
  return { point: make_point(rect.x + px, rect.y + py), normal }
}

function connection_port(node: PlacedConnection, side: Side, loc = 0.5): Port {
  if (!['top', 'right', 'bottom', 'left'].includes(side)) throw new TypeError('Unknown connection side')
  finite(loc, 'connection location')
  if (loc < 0 || loc > 1) throw new RangeError('Connection location must be between 0 and 1')
  const { point, normal } = boundary_port(node.boundary, side, loc)
  const [a, b, c, d] = node.transform, det = a * d - b * c
  if (!det) throw new RangeError(`Cannot attach to node ${node.id} through a singular transform`)
  // Normals use the inverse transpose, so sheared frames still have perpendicular exits.
  const nx = (d * normal.x - b * normal.y) / det, ny = (a * normal.y - c * normal.x) / det
  const length = Math.hypot(nx, ny)
  return { point: transform_point(point, node.transform), normal: make_point(nx / length, ny / length) }
}

export { collect_connections, connection_center, connection_side, connection_port }
export type { PlacedConnection, Port }
