import { resolve_alignment } from './composition';
import type { AlignmentValue } from './composition';
import { define_element, element_children } from './element';
import type { ElementProps } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point, make_rect } from './geometry';
import { available, make_request, shape_size } from './layout';
import type { LayoutQuery } from './pass';
import { resolve_font_size, resolve_length } from './units';
import type { Length } from './units';

type AnchorValue = Exclude<AlignmentValue, 'stretch'>;
type Anchor = AnchorValue | Readonly<{ x?: AnchorValue; y?: AnchorValue }>
  | readonly [x: AnchorValue, y: AnchorValue];
type PositionSpec = Readonly<{ x?: Length; y?: Length; anchor?: Anchor }>;
type GroupProps = ElementProps & Readonly<{ clip?: boolean }>;

// A canvas selects its extent before measuring children. Finite offers are used
// in full; a preferred aspect can derive a missing axis. There is no child-sized
// fallback or percentage feedback, so an unbounded canvas needs explicit sizing.
function group_size(query: LayoutQuery) {
  const missing = (['width', 'height'] as const).filter(axis => query.request[axis].kind === 'natural');
  if (missing.length && (missing.length === 2 || query.sizing.aspect === undefined)) {
    throw new TypeError(`Group needs a finite ${missing.join(' and ')}; provide dimensions or an offer, `
      + 'or one dimension and aspect');
  }
  return shape_size(query.request, query.sizing);
}

const Group = define_element<GroupProps>('Group', (props, query) => {
  const size = group_size(query);
  const request = make_request({ width: available(size.width), height: available(size.height) });
  const children = element_children(props.children).map((element, index) => {
    const { x = 0, y = 0, anchor = 'start' } = element.props;
    const path = `${query.path}/${element.type.name}[${index}]`;
    const font_size = resolve_font_size(element.props.font_size, query.style.font_size, `${path}.font_size`);

    // Position lengths use the child's local font and the whole group rectangle.
    // Moving the origin or anchor never changes the child's available-space offer.
    const point = make_point(
      resolve_length(x, { font_size, fraction: size.width }, `${path}.x`),
      resolve_length(y, { font_size, fraction: size.height }, `${path}.y`),
    );
    const align = resolve_alignment(anchor, `${path}.anchor`);
    if (align.x === 'stretch' || align.y === 'stretch') {
      throw new TypeError(`${path}.anchor selects a point; use width and height to size the child`);
    }

    // Preferred child dimensions create sized regions through ordinary layout.
    // Text reflows, shapes resize, and explicit Fit children can scale drawings.
    const fragment = query.child(element, request, size, index);
    const offset = make_point(point.x - fragment.size.width * align.x,
      point.y - fragment.size.height * align.y);
    return place_fragment(fragment, offset);
  });

  // Source order is paint order. The canvas owns its size, while fragment bounds
  // retain child overflow, including when an optional canvas clip hides the ink.
  const clip = props.clip ? make_rect(0, 0, size.width, size.height) : undefined;
  return make_fragment({ size, children, clip });
});

export { Group };
export type { GroupProps, PositionSpec, Anchor, AnchorValue };
