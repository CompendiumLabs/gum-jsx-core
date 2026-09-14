import { nonnegative } from '../lib/checks'
import { definite_reference, resolve_alignment } from '../lib/composition'
import type { AlignmentValue } from '../lib/composition'
import { Element, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { distribute_flex } from '../lib/flex'
import { make_fragment, place_fragment, transform_guides } from '../engine/fragment'
import type { Fragment, Guides, Placement } from '../engine/fragment'
import { make_point, make_size } from '../engine/geometry'
import { available, exact, natural, make_request, finish_size, resolve_sizing } from '../engine/layout'
import type { Axis, AxisRequest, Sizing } from '../engine/layout'
import type { LayoutQuery } from '../engine/pass'
import { resolve_font_size, resolve_length } from '../engine/units'
import type { Length, ReferenceBox } from '../engine/units'

type StackAlign = AlignmentValue | 'baseline'
type ResolvedStackAlign = number | 'stretch' | 'baseline'
type StackJustify = Exclude<AlignmentValue, 'stretch'>
  | 'space_between' | 'space_around' | 'space_evenly'
type StackProps = ElementProps & Readonly<{
  gap?: Length
  align?: StackAlign
  justify?: StackJustify
}>
type Item = {
  element: Element
  index: number
  sizing: Sizing
  basis?: number
  grow: number
  shrink: number
  align: ResolvedStackAlign
  fragment?: Fragment
}

// Stack alignment is one cross-axis value, not Box's two-axis alignment.
function stack_alignment(align: StackAlign, main: Axis, path: string): ResolvedStackAlign {
  if (align === 'baseline') {
    if (main !== 'width') throw new TypeError(`${path}: Baseline alignment is available on HStack`)
    return align
  }
  if (typeof align !== 'number' && typeof align !== 'string') {
    throw new TypeError(`${path}: stack alignment needs a single alignment value`)
  }
  return resolve_alignment(align, path).x
}

// Resolve parent-owned flex metadata with the child's local font and a stable
// containing box. Trial allocations never become fractional reference lengths.
function stack_item(element: Element, index: number, main: Axis,
  query: LayoutQuery, reference: ReferenceBox, align: ResolvedStackAlign): Item {
  const { props } = element
  const path = `${query.path}/${element.type.name}[${index}]`
  const font_size = resolve_font_size(props.font_size, query.style.font_size, `${path}.font_size`)
  const sizing = resolve_sizing(props, { font_size, reference, path })
  const basis = props.basis === undefined ? sizing[main].preferred
    : nonnegative(resolve_length(props.basis, { font_size, fraction: reference[main] },
      `${path}.basis`), `${path}.basis`)
  return { element, index, sizing, basis,
    align: props.align_self === undefined ? align
      : stack_alignment(props.align_self, main, `${path}.align_self`),
    grow: nonnegative(props.grow ?? 0, `${path}.grow`),
    shrink: nonnegative(props.shrink ?? 0, `${path}.shrink`) }
}

// Pack leftover space after flex allocation. Distributed spacing never makes
// gaps negative; center/end can place overflowing content before the origin.
function pack_stack(justify: StackJustify, count: number, free: number, gap: number) {
  if (justify === 'space_between' || justify === 'space_around' || justify === 'space_evenly') {
    if (free <= 0 || count === 0) return { offset: 0, gap }
    if (justify === 'space_between') return { offset: 0, gap: gap + (count > 1 ? free / (count - 1) : 0) }
    const space = free / (justify === 'space_around' ? count : count + 1)
    return { offset: justify === 'space_around' ? space / 2 : space, gap: gap + space }
  }
  const align = resolve_alignment(justify).x
  if (align === 'stretch') throw new TypeError('Use grow to distribute stack space')
  return { offset: free * align, gap }
}

// Expose the first child's named guides and the last textual child's last baseline.
function stack_guides(children: readonly Placement[]): Guides {
  const first = children.find(child => Object.keys(child.fragment.guides).length)
  const guides = first ? transform_guides(first.fragment.guides, first.offset.y) : {}
  const last = children.findLast(child => child.fragment.guides.last_baseline !== undefined
    || child.fragment.guides.baseline !== undefined)
  const baseline = last?.fragment.guides.last_baseline ?? last?.fragment.guides.baseline
  return { ...guides, ...(last && baseline !== undefined
    ? { last_baseline: last.offset.y + baseline } : {}) }
}

// Both axes use the same packing and allocation. Text makes the stretch order
// significant: a column establishes its shared width before allocating heights;
// a row allocates widths before finding the height of its reflowed children.
// A measured cross axis is selected once, without percentage feedback or search.
function stack_layout(props: StackProps, query: LayoutQuery, main: Axis) {
  const cross = main === 'width' ? 'height' : 'width'
  const align = stack_alignment(props.align ?? 'start', main, `${query.path}.align`)
  const reference = definite_reference(query.request, query.sizing)
  const gap = nonnegative(resolve_length(props.gap ?? 0, {
    font_size: query.style.font_size, fraction: reference[main],
  }, `${query.path}.gap`), `${query.path}.gap`)
  const items = element_children(props.children).map((element, index) =>
    stack_item(element, index, main, query, reference, align))
  const gaps = Math.max(0, items.length - 1) * gap
  const stretching = items.some(item => item.align === 'stretch')

  const offer = query.request[cross]
  const cross_offer = offer.kind === 'exact' ? available(offer.value) : offer
  let cross_size = reference[cross]
  function cross_request(item: Item): AxisRequest {
    return item.align === 'stretch' && cross_size !== undefined ? exact(cross_size) : cross_offer
  }
  const size_axes = (length: number, breadth: number) => main === 'width'
    ? make_size(length, breadth) : make_size(breadth, length)
  const select_cross = (breadth: number) =>
    finish_size(size_axes(0, breadth), query.request, query.sizing)[cross]

  // Only intrinsic bases require a probe. A stretching column also needs each
  // child's width before it can measure the heights for its final shared width.
  const column_stretch = main === 'height' && stretching && cross_size === undefined
  function measure(item: Item, request: AxisRequest): Fragment {
    return query.child(item.element, make_request({ [main]: request, [cross]: cross_request(item) }),
      reference, item.index)
  }
  for (const item of items) {
    if (item.basis === undefined) item.fragment = measure(item, natural())
    else if (column_stretch) {
      const { min, max } = item.sizing[main]
      item.fragment = measure(item, exact(Math.max(min, Math.min(max, item.basis))))
    }
  }
  if (column_stretch) {
    cross_size = select_cross(Math.max(0, ...items.map(item => item.fragment!.size[cross])))
    for (const item of items) {
      if (item.align === 'stretch' && item.basis === undefined && item.fragment!.size[cross] !== cross_size) {
        item.fragment = measure(item, natural())
      }
    }
  }

  // Reserve gaps first. Natural packing has no surplus except any own minimum;
  // a finite offer supplies a budget, while exact own sizing fixes the frame.
  const flex = items.map(item => ({
    basis: item.basis ?? item.fragment!.size[main],
    min: item.sizing[main].min, max: item.sizing[main].max,
    grow: item.grow, shrink: item.shrink,
  }))
  const bases = distribute_flex(flex)
  const packed = bases.reduce((sum, size) => sum + size, gaps)
  const main_request = query.request[main]
  const target = main_request.kind === 'natural' ? Math.max(packed, query.sizing[main].min)
    : main_request.value
  const sizes = distribute_flex(flex, Math.max(0, target - gaps))
  let fragments = items.map((item, index) => {
    const fragment = item.fragment
    const offer = cross_request(item)
    const cross_fits = offer.kind !== 'exact' || fragment?.size[cross] === offer.value
    return fragment?.size[main] === sizes[index] && cross_fits ? fragment
      : measure(item, exact(sizes[index]))
  })

  // Baselines may lie outside a child's allocation. Include both sides of the
  // guide, but only for participating children. Other children retain their own
  // alignment; a baseline participant without a guide uses its bottom edge.
  const baselines = fragments.map(fragment => fragment.guides.baseline ?? fragment.size.height)
  const baseline_items = items.filter(item => item.align === 'baseline')
  const above = Math.max(0, ...baseline_items.map(item => baselines[item.index]))
  const below = Math.max(0, ...baseline_items.map(item =>
    fragments[item.index].size.height - baselines[item.index]))
  const breadth = Math.max(above + below, 0, ...fragments.map(fragment => fragment.size[cross]))
  const length = sizes.reduce((sum, size) => sum + size, gaps)
  // A stretching column keeps the width selected before height allocation.
  // Later growth in non-stretch children is overflow, not a new reflow cycle.
  const size = finish_size(size_axes(length, cross_size ?? breadth), query.request, query.sizing)
  // A row's width allocation and baseline group are now known. Stretch only
  // participating children to its chosen height, without changing their widths.
  if (stretching && cross_size === undefined) {
    cross_size = size[cross]
    fragments = fragments.map((fragment, index) =>
      items[index].align !== 'stretch' || fragment.size[cross] === cross_size ? fragment
        : measure(items[index], exact(sizes[index])))
  }

  const packing = pack_stack(props.justify ?? 'start', items.length, size[main] - length, gap)
  let position = packing.offset
  const children = fragments.map((fragment, index) => {
    const align = items[index].align
    const offset = align === 'baseline' ? above - baselines[index]
      : (size[cross] - fragment.size[cross]) * (align === 'stretch' ? 0 : align)
    const point = main === 'width' ? make_point(position, offset) : make_point(offset, position)
    position += sizes[index] + packing.gap
    return place_fragment(fragment, point)
  })
  const guides = stack_guides(children)
  return make_fragment({ size, children,
    guides: baseline_items.length ? { ...guides, baseline: above } : guides })
}

class HStack extends Element<StackProps> {
  static layout(props: StackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'width')
  }
}

class VStack extends Element<StackProps> {
  static layout(props: StackProps, query: LayoutQuery) {
    return stack_layout(props, query, 'height')
  }
}

// The defaults live in the description, so parents treat Spacer like any item.
class Spacer extends Element<ElementProps> {
  static defaults: Partial<ElementProps> = { basis: 0, grow: 1 }
  static layout(props: ElementProps, query: LayoutQuery) {
    if (element_children(props.children).length) throw new TypeError('Spacer has no content children')
    return make_fragment({ size: finish_size(make_size(), query.request, query.sizing) })
  }
}

export { HStack, VStack, Spacer, stack_layout }
export type { StackProps, StackAlign, StackJustify }
