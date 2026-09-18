import { nonnegative } from '../lib/checks'
import { collect_connections, connection_center, connection_port, connection_side } from '../lib/connections'
import type { PlacedConnection } from '../lib/connections'
import { coordinate_length, infer_coordinates, point_bounds } from '../engine/coordinates'
import type { DataBounds } from '../engine/coordinates'
import { Element, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment } from '../engine/fragment'
import type { Placement } from '../engine/fragment'
import { make_point, make_rect, read_point } from '../engine/geometry'
import type { Point } from '../engine/geometry'
import { exact, make_request } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { resolve_paint } from '../engine/style'
import { em, px, resolve_length } from '../engine/units'
import type { Length } from '../engine/units'
import { box_layout } from './box'
import type { BoxProps } from './box'
import { TextBox } from './document'
import type { TextBoxProps } from './document'
import { graph_child, graph_size } from './graph'
import type { GraphProps } from './graph'
import { arrow_draw, arrow_head_options, head_scope, resolve_arrow_head } from './marks'
import type { ArrowProps } from './marks'
import type { Side } from './placement'

type NodeProps = TextBoxProps
type EdgeProps = Omit<ArrowProps, 'from' | 'to'> & Readonly<{
  start: string | Element; end: string | Element
  start_side?: Side; end_side?: Side; start_loc?: number; end_loc?: number
  gap?: Length
}>
type EdgeData = Omit<EdgeProps, 'start' | 'end'> & Readonly<{ start: string; end: string }>
type NetworkProps = GraphProps
// Components adopt a source type's layout function, preserving this capability
// even when the resulting element has a different name or prototype.
const edge_layouts = new WeakSet<Element['type']['layout']>()

function node_id(id: unknown): string {
  if (typeof id !== 'string' || !id.length) throw new TypeError('A node id must be a nonempty string')
  return id
}

// Numeric x/y locate a child in data space, whatever kind of element it is.
function position_bounds({ x, y }: ElementProps): DataBounds {
  return { ...(typeof x === 'number' ? { xlim: [x, x] as const } : {}),
    ...(typeof y === 'number' ? { ylim: [y, y] as const } : {}) }
}

// Any element with an id is a node. Node is the conventional one: a centered,
// framed label whose connection boundary comes from its box like any other.
class Node extends Element<BoxProps, NodeProps> {
  static defaults: Partial<BoxProps> = {
    x: 0, y: 0, anchor: 'center', width: 'fit', align: 'center',
    padding: em(0.6), border_width: px(1), radius: em(0.3),
  }
  static normalize = TextBox.normalize
  static data_bounds = position_bounds
  static layout = box_layout
}

// An Edge describes a relationship. Network resolves it against completed node
// placements; measuring it independently would have no endpoint geometry.
class Edge extends Element<EdgeData, EdgeProps> {
  constructor(props: EdgeProps) {
    super(props)
    edge_layouts.add(this.type.layout)
  }
  static normalize(props: EdgeProps): EdgeData {
    const endpoint = (value: string | Element) => node_id(value instanceof Element ? value.props.id : value)
    return { ...head_scope(props), start: endpoint(props.start), end: endpoint(props.end) }
  }
  static data_bounds(props: EdgeData) {
    return props.space === 'local' ? null : point_bounds((props.points ?? []).map(value => {
      const point = read_point(value)
      return typeof point.x === 'number' && typeof point.y === 'number' ? point as Point : null
    }))
  }
  static layout(): never {
    throw new TypeError('Edge must be a direct child of Network')
  }
}

function is_edge(element: Element): element is Element<EdgeData> {
  return edge_layouts.has(element.type.layout)
}

function edge_fragment(props: EdgeData, query: LayoutQuery, nodes: ReadonlyMap<string, PlacedConnection>) {
  if (element_children(props.children).length) throw new TypeError('Edges have no content children')
  if (props.space && !['local', 'data'].includes(props.space)) throw new TypeError('Unknown geometry space')
  const get = (id: string) => {
    const node = nodes.get(id)
    if (!node) throw new TypeError(`Unknown node id: ${id}`)
    return node
  }
  const start_node = get(props.start), end_node = get(props.end)
  const size = graph_size(query), font_size = query.style.font_size
  const coord = props.space === 'local' ? undefined : query.coordinates
  const points = (props.points ?? []).map(value => {
    const p = read_point(value)
    return make_point(coordinate_length(p.x, 'x', size, font_size, coord),
      coordinate_length(p.y, 'y', size, font_size, coord))
  })
  const self = props.start === props.end
  const start_side = props.start_side ?? (self ? 'right'
    : connection_side(start_node, points[0] ?? connection_center(end_node)))
  const end_side = props.end_side ?? (self ? 'top'
    : connection_side(end_node, points.at(-1) ?? connection_center(start_node)))
  const start = connection_port(start_node, start_side, props.start_loc)
  const end = connection_port(end_node, end_side, props.end_loc)
  const length = (value: Length, name: string) => nonnegative(resolve_length(value,
    { font_size, fraction: Math.min(size.width, size.height) }, name), name)
  const gap = length(props.gap ?? 0, 'gap'), radius = length(props.radius ?? 0, 'radius')
  const step = (p: Point, n: Point, by: number) => make_point(p.x + n.x * by, p.y + n.y * by)
  const a = step(start.point, start.normal, gap), b = step(end.point, end.normal, gap)
  const curve = props.curve ?? !radius
  let route = [a, ...points, b]
  if ((!curve && radius) || self) {
    const distance = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y)
    const reach = (p: Point, q: Point) => self ? font_size * 2 : Math.min(font_size * 2, distance(p, q) / 3)
    const first = step(a, start.normal, reach(a, points[0] ?? b))
    const last = step(b, end.normal, reach(b, points.at(-1) ?? a))
    const middle = self && !points.length
      ? [make_point(first.x + last.x - connection_center(start_node).x,
        first.y + last.y - connection_center(start_node).y)] : points
    route = curve ? [a, ...middle, b] : [a, first, ...middle, last, b]
  }
  const paint = resolve_paint(query.style, size, query.path)
  const head = resolve_arrow_head(arrow_head_options(props), size, query.style, query.path, paint)
  const directions = curve && (props.tension ?? 1) > 0 ? { start: start.normal,
    end: make_point(-end.normal.x, -end.normal.y) } : undefined
  return make_fragment({ size, draw: arrow_draw(route, paint, head, { ...props, curve }, radius, directions) })
}

class Network extends Element<NetworkProps> {
  static defaults: Partial<NetworkProps> = { padding: 0.2 }
  static data_bounds() { return null; }
  static layout(props: NetworkProps, query: LayoutQuery) {
    const size = graph_size(query)
    const elements = element_children(props.children)
    // Positioned children are nodes or annotations alike; both belong in view.
    const coordinates = query.prepare('coordinates', () => infer_coordinates(elements, props,
      elements.filter(element => !is_edge(element)).map(element => position_bounds(element.props))))
    const children: Placement[] = []
    elements.forEach((element, index) => {
      if (!is_edge(element)) children[index] = graph_child(element, query, size, coordinates, index)
    })
    const nodes = collect_connections(children.filter(Boolean))
    const request = make_request({ width: exact(size.width), height: exact(size.height) })
    elements.forEach((element, index) => {
      if (!is_edge(element)) return
      // Geometry belongs to this result, never to the source Edge or a mutable
      // lookup in LayoutContext. Ordinary child layout still resolves edge style.
      const resolved = new Element({ name: element.type.name,
        layout: (source, child_query) => edge_fragment(source.props as EdgeData, child_query, nodes) }, element.props)
      children[index] = place_fragment(query.child(resolved, request, size, index, { coordinates }))
    })
    const area = make_rect(0, 0, size.width, size.height)
    return make_fragment({ size, children, content: area, clip: props.clip ? area : undefined,
      connection_scope: true })
  }
}

export { Node, Edge, Network }
export type { NodeProps, EdgeProps, NetworkProps }
