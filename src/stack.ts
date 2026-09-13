import { nonnegative } from './checks';
import { definite_reference, resolve_alignment } from './composition';
import type { AlignmentValue } from './composition';
import { Element, element_children } from './element';
import type { ElementProps } from './element';
import { distribute_flex } from './flex';
import { make_fragment, place_fragment, transform_guides } from './fragment';
import type { Fragment, Guides, Placement } from './fragment';
import { make_point, make_size } from './geometry';
import { available, exact, natural, make_request, finish_size, resolve_sizing } from './layout';
import type { Axis, AxisRequest, Sizing } from './layout';
import type { LayoutQuery } from './pass';
import { resolve_font_size, resolve_length } from './units';
import type { Length, ReferenceBox } from './units';

type StackAlign = AlignmentValue | 'baseline';
type StackJustify = Exclude<AlignmentValue, 'stretch'>
  | 'space_between' | 'space_around' | 'space_evenly';
type StackProps = ElementProps & Readonly<{
  gap?: Length;
  align?: StackAlign;
  justify?: StackJustify;
}>;
type Item = {
  element: Element;
  index: number;
  sizing: Sizing;
  basis?: number;
  grow: number;
  shrink: number;
  fragment?: Fragment;
};

// Resolve parent-owned flex metadata with the child's local font and a stable
// containing box. Trial allocations never become fractional reference lengths.
function stack_item(element: Element, index: number, main: Axis,
  query: LayoutQuery, reference: ReferenceBox): Item {
  const { props } = element;
  const path = `${query.path}/${element.type.name}[${index}]`;
  const font_size = resolve_font_size(props.font_size, query.style.font_size, `${path}.font_size`);
  const sizing = resolve_sizing(props, { font_size, reference, path });
  const basis = props.basis === undefined ? sizing[main].preferred
    : nonnegative(resolve_length(props.basis, { font_size, fraction: reference[main] },
      `${path}.basis`), `${path}.basis`);
  return { element, index, sizing, basis,
    grow: nonnegative(props.grow ?? 0, `${path}.grow`),
    shrink: nonnegative(props.shrink ?? 0, `${path}.shrink`) };
}

// Pack leftover space after flex allocation. Distributed spacing never makes
// gaps negative; center/end can place overflowing content before the origin.
function pack_stack(justify: StackJustify, count: number, free: number, gap: number) {
  if (justify === 'space_between' || justify === 'space_around' || justify === 'space_evenly') {
    if (free <= 0 || count === 0) return { offset: 0, gap };
    if (justify === 'space_between') return { offset: 0, gap: gap + (count > 1 ? free / (count - 1) : 0) };
    const space = free / (justify === 'space_around' ? count : count + 1);
    return { offset: justify === 'space_around' ? space / 2 : space, gap: gap + space };
  }
  const align = resolve_alignment(justify).x;
  if (align === 'stretch') throw new TypeError('Use grow to distribute stack space');
  return { offset: free * align, gap };
}

// Expose the first child's named guides and the last textual child's last baseline.
function stack_guides(children: readonly Placement[]): Guides {
  const first = children.find(child => Object.keys(child.fragment.guides).length);
  const guides = first ? transform_guides(first.fragment.guides, first.offset.y) : {};
  const last = children.findLast(child => child.fragment.guides.last_baseline !== undefined
    || child.fragment.guides.baseline !== undefined);
  const baseline = last?.fragment.guides.last_baseline ?? last?.fragment.guides.baseline;
  return { ...guides, ...(last && baseline !== undefined
    ? { last_baseline: last.offset.y + baseline } : {}) };
}

// Both axes use the same packing and allocation. Text makes the stretch order
// significant: a column establishes its shared width before allocating heights;
// a row allocates widths before finding the height of its reflowed children.
// A measured cross axis is selected once, without percentage feedback or search.
function stack_layout(props: StackProps, query: LayoutQuery, main: Axis) {
  const cross = main === 'width' ? 'height' : 'width';
  const align = props.align === 'baseline' ? 'baseline' : resolve_alignment(props.align ?? 'start').x;
  if (align === 'baseline' && main !== 'width') {
    throw new TypeError('Baseline alignment is available on HStack');
  }
  const reference = definite_reference(query.request, query.sizing);
  const gap = nonnegative(resolve_length(props.gap ?? 0, {
    font_size: query.style.font_size, fraction: reference[main],
  }, `${query.path}.gap`), `${query.path}.gap`);
  const items = element_children(props.children).map((element, index) =>
    stack_item(element, index, main, query, reference));
  const gaps = Math.max(0, items.length - 1) * gap;

  const offer = query.request[cross];
  let cross_request: AxisRequest = align === 'stretch' && reference[cross] !== undefined
    ? exact(reference[cross]) : offer.kind === 'exact' ? available(offer.value) : offer;
  const size_axes = (length: number, breadth: number) => main === 'width'
    ? make_size(length, breadth) : make_size(breadth, length);
  const select_cross = (breadth: number) =>
    finish_size(size_axes(0, breadth), query.request, query.sizing)[cross];

  // Only intrinsic bases require a probe. A stretching column also needs each
  // child's width before it can measure the heights for its final shared width.
  const column_stretch = main === 'height' && align === 'stretch' && cross_request.kind !== 'exact';
  function measure(item: Item, request: AxisRequest): Fragment {
    return query.child(item.element, make_request({ [main]: request, [cross]: cross_request }),
      reference, item.index);
  }
  for (const item of items) {
    if (item.basis === undefined) item.fragment = measure(item, natural());
    else if (column_stretch) {
      const { min, max } = item.sizing[main];
      item.fragment = measure(item, exact(Math.max(min, Math.min(max, item.basis))));
    }
  }
  if (column_stretch) {
    const breadth = select_cross(Math.max(0, ...items.map(item => item.fragment!.size[cross])));
    cross_request = exact(breadth);
    for (const item of items) {
      if (item.basis === undefined && item.fragment!.size[cross] !== breadth) {
        item.fragment = measure(item, natural());
      }
    }
  }

  // Reserve gaps first. Natural packing has no surplus except any own minimum;
  // a finite offer supplies a budget, while exact own sizing fixes the frame.
  const flex = items.map(item => ({
    basis: item.basis ?? item.fragment!.size[main],
    min: item.sizing[main].min, max: item.sizing[main].max,
    grow: item.grow, shrink: item.shrink,
  }));
  const bases = distribute_flex(flex);
  const packed = bases.reduce((sum, size) => sum + size, gaps);
  const main_request = query.request[main];
  const target = main_request.kind === 'natural' ? Math.max(packed, query.sizing[main].min)
    : main_request.value;
  const sizes = distribute_flex(flex, Math.max(0, target - gaps));
  let fragments = items.map((item, index) => {
    const fragment = item.fragment;
    const cross_fits = cross_request.kind !== 'exact' || fragment?.size[cross] === cross_request.value;
    return fragment?.size[main] === sizes[index] && cross_fits ? fragment
      : measure(item, exact(sizes[index]));
  });

  // A row's line count is now known. Stretch completed allocations to its chosen
  // height; widths stay fixed, and text retains its measured glyphs and overflow.
  if (align === 'stretch' && cross_request.kind !== 'exact') {
    const breadth = select_cross(Math.max(0, ...fragments.map(fragment => fragment.size[cross])));
    cross_request = exact(breadth);
    fragments = fragments.map((fragment, index) => fragment.size[cross] === breadth ? fragment
      : measure(items[index], exact(sizes[index])));
  }

  // Baselines may lie outside a child's allocation. Include both sides of the
  // guide in the row's height; a child without a guide uses its bottom edge.
  const baselines = fragments.map(fragment => fragment.guides.baseline ?? fragment.size.height);
  const above = align === 'baseline' ? Math.max(0, ...baselines) : 0;
  const below = align === 'baseline' ? Math.max(0, ...fragments.map((fragment, index) =>
    fragment.size.height - baselines[index])) : 0;
  const breadth = align === 'baseline' ? above + below
    : Math.max(0, ...fragments.map(fragment => fragment.size[cross]));
  const length = sizes.reduce((sum, size) => sum + size, gaps);
  const size = finish_size(size_axes(length, breadth), query.request, query.sizing);
  const packing = pack_stack(props.justify ?? 'start', items.length, size[main] - length, gap);
  let position = packing.offset;
  const children = fragments.map((fragment, index) => {
    const offset = align === 'baseline' ? above - baselines[index]
      : (size[cross] - fragment.size[cross]) * (align === 'stretch' ? 0 : align);
    const point = main === 'width' ? make_point(position, offset) : make_point(offset, position);
    position += sizes[index] + packing.gap;
    return place_fragment(fragment, point);
  });
  const guides = stack_guides(children);
  return make_fragment({ size, children,
    guides: align === 'baseline' && items.length ? { ...guides, baseline: above } : guides });
}

class HStack extends Element<StackProps> {
  static layout(props: StackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'width');
  }
}

class VStack extends Element<StackProps> {
  static layout(props: StackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'height');
  }
}

// The defaults live in the description, so parents treat Spacer like any item.
class Spacer extends Element<ElementProps> {
  static defaults: Partial<ElementProps> = { basis: 0, grow: 1 };
  static layout(props: ElementProps, query: LayoutQuery) {
    if (element_children(props.children).length) throw new TypeError('Spacer has no content children');
    return make_fragment({ size: finish_size(make_size(), query.request, query.sizing) });
  }
}

export { HStack, VStack, Spacer, stack_layout };
export type { StackProps, StackAlign, StackJustify };
