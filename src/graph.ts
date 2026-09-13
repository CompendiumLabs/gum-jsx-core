import { resolve_alignment } from './composition';
import { coordinate_length, infer_coordinates } from './coordinates';
import type { Coordinates, CoordinateSpec } from './coordinates';
import { Element, element_children } from './element';
import type { ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point, make_rect } from './geometry';
import type { Size } from './geometry';
import { available, make_request, shape_size } from './layout';
import type { LayoutQuery } from './pass';
import { resolve_font_size } from './units';

type GraphProps = ElementProps & CoordinateSpec & Readonly<{ clip?: boolean }>;

// Graphs have a useful natural size, occupy offers, and derive an unoffered axis
// from aspect. Explicit exact dimensions still override that preferred ratio.
function graph_size(query: LayoutQuery, aspect = 1.5): Size {
  const { width, height } = query.request;
  const request = width.kind === 'natural' && height.kind === 'natural'
    ? make_request({ width: available(480) }) : query.request;
  const ratio = query.sizing.aspect ?? (width.kind === 'natural' || height.kind === 'natural' ? aspect : undefined);
  return shape_size(request, { ...query.sizing, aspect: ratio });
}

// Both graph marks and annotations get ordinary layout requests. Numeric x/y
// metadata locates annotations in data space; omitted positions stay at the origin.
function graph_children(elements: readonly Element[], query: LayoutQuery, size: Size,
  coordinates: Coordinates) {
  const request = make_request({ width: available(size.width), height: available(size.height) });
  return elements.map((element, index) => {
    const fragment = query.child(element, request, size, index, { coordinates });
    const { x, y, anchor = 'start' } = element.props;
    const path = `${query.path}/${element.type.name}[${index}]`;
    const font = resolve_font_size(element.props.font_size, query.style.font_size, `${path}.font_size`);
    const align = resolve_alignment(anchor, `${path}.anchor`);
    if (align.x === 'stretch' || align.y === 'stretch') throw new TypeError('An anchor selects a point');
    const left = x === undefined ? 0 : coordinate_length(x, 'x', size, font, coordinates, `${path}.x`);
    const top = y === undefined ? 0 : coordinate_length(y, 'y', size, font, coordinates, `${path}.y`);
    return place_fragment(fragment,
      make_point(left - align.x * fragment.size.width, top - align.y * fragment.size.height));
  });
}

class Graph extends Element<GraphProps> {
  static data_bounds() {
    return null;
  }
  static layout(props: GraphProps, query: LayoutQuery) {
    const size = graph_size(query);
    const coordinates = query.prepare('coordinates', () => infer_coordinates(props.children, props));
    const children = graph_children(element_children(props.children), query, size, coordinates);
    const area = make_rect(0, 0, size.width, size.height);
    return make_fragment({ size, children, content: area, clip: props.clip ? area : undefined });
  }
}

export { Graph, graph_size, graph_children };
export type { GraphProps };
