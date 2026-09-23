import { resolve_alignment } from '../lib/composition'
import { coordinate_length, infer_coordinates } from '../engine/coordinates'
import type { Coordinates, CoordinateSpec } from '../engine/coordinates'
import { Element, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment } from '../engine/fragment'
import { make_point, make_rect } from '../engine/geometry'
import type { Size } from '../engine/geometry'
import { available, make_request, shape_size } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { child_measure } from '../engine/pass'

type GraphProps = ElementProps & CoordinateSpec & Readonly<{ clip?: boolean }>

// Graphs have a useful natural size, occupy offers, and derive an unoffered axis
// from aspect. Explicit exact dimensions still override that preferred ratio.
function graph_size(query: LayoutQuery, aspect = 1.5): Size {
  const { width, height } = query.request
  const request = width.kind === 'natural' && height.kind === 'natural'
    ? make_request({ width: available(480) }) : query.request
  const ratio = query.sizing.aspect ?? (width.kind === 'natural' || height.kind === 'natural' ? aspect : undefined)
  return shape_size(request, { ...query.sizing, aspect: ratio })
}

// Both graph marks and annotations get ordinary layout requests. Numeric x/y
// metadata locates annotations in data space; omitted positions stay at the origin.
function graph_children(elements: readonly Element[], query: LayoutQuery, size: Size,
  coordinates: Coordinates) {
  return elements.map((element, index) => graph_child(element, query, size, coordinates, index))
}

// Network shares placement with Graph while choosing its own measurement order.
function graph_child(element: Element, query: LayoutQuery, size: Size,
  coordinates: Coordinates, index: number) {
  const request = make_request({ width: available(size.width), height: available(size.height) })
  const fragment = query.child(element, request, size, index, { coordinates })
  const { x, y, anchor = 'start' } = element.props
  const measure = child_measure(element, query, index, size)
  const { path } = measure
  const align = resolve_alignment(anchor, `${path}.anchor`)
  if (typeof align.x !== 'number' || typeof align.y !== 'number') throw new TypeError('An anchor selects a point')
  const left = x === undefined ? 0 : coordinate_length(x, 'x', size, measure, coordinates)
  const top = y === undefined ? 0 : coordinate_length(y, 'y', size, measure, coordinates)
  return place_fragment(fragment,
    make_point(left - align.x * fragment.size.width, top - align.y * fragment.size.height))
}

class Graph extends Element<GraphProps> {
  static data_bounds() {
    return null
  }
  static layout(props: GraphProps, query: LayoutQuery) {
    const size = graph_size(query)
    const coordinates = query.prepare('coordinates', () => infer_coordinates(props.children, props))
    const children = graph_children(element_children(props.children), query, size, coordinates)
    const area = make_rect(0, 0, size.width, size.height)
    return make_fragment({ size, children, content: area, clip: props.clip ? area : undefined })
  }
}

export { Graph, graph_size, graph_children, graph_child }
export type { GraphProps }

// Generated prop registrations; run the workspace props:generate command.
import { register_props } from '../engine/prop_validation'
import { prop_schemas } from '../prop-schemas'
register_props(Graph, prop_schemas.Graph)
