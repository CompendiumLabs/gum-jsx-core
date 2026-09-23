import { nonnegative } from '../lib/checks'
import { aligned_request, definite_reference, fills_axis, resolve_alignment } from '../lib/composition'
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
import { child_measure } from '../engine/pass'
import { px, resolve_length } from '../engine/units'
import type { Length, ReferenceBox } from '../engine/units'

type StackAlign = AlignmentValue | 'baseline'
type ResolvedStackAlign = number | 'stretch' | 'fill' | 'baseline'
type StackJustify = Exclude<AlignmentValue, 'stretch' | 'fill'>
  | 'space-between' | 'space-around' | 'space-evenly'
type StackProps = ElementProps & Readonly<{
  gap?: Length
  align?: StackAlign
  justify?: StackJustify
  wrap?: boolean
  line_gap?: Length
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
  const measure = child_measure(element, query, index, reference)
  const { path } = measure
  const sizing = resolve_sizing(props, measure)
  const grow = nonnegative(props.grow ?? 0, `${path}.grow`)
  // Unsized growth divides a finite budget from zero. Natural measurement,
  // and an explicit auto basis retain content-based starting sizes.
  const zero_basis = props.basis === undefined && grow > 0
    && query.request[main].kind !== 'natural'
  const basis = props.basis === undefined || props.basis === 'auto'
    ? sizing[main].preferred ?? (zero_basis ? 0 : undefined)
    : nonnegative(resolve_length(props.basis, measure, reference[main], 'basis'), `${path}.basis`)
  let self = props.align_self
  if (self === null) throw new TypeError(`${path}.align_self: expected an alignment`)
  if (typeof self === 'object') {
    const axis = main === 'width' ? 'y' : 'x'
    const resolved = resolve_alignment(self, `${path}.align_self`)
    self = 'length' in self || self[axis] !== undefined ? resolved[axis] : undefined
  }
  return { element, index, sizing, basis, grow,
    align: self === undefined ? align : stack_alignment(self, main, `${path}.align_self`),
    shrink: nonnegative(props.shrink ?? 0, `${path}.shrink`) }
}

// Pack leftover space after flex allocation. Distributed spacing never makes
// gaps negative; center/end can place overflowing content before the origin.
function pack_stack(justify: StackJustify, count: number, free: number, gap: number) {
  if (justify === 'space-between' || justify === 'space-around' || justify === 'space-evenly') {
    if (free <= 0 || count === 0) return { offset: 0, gap }
    if (justify === 'space-between') return { offset: 0, gap: gap + (count > 1 ? free / (count - 1) : 0) }
    const space = free / (justify === 'space-around' ? count : count + 1)
    return { offset: justify === 'space-around' ? space / 2 : space, gap: gap + space }
  }
  const align = resolve_alignment(justify).x
  if (typeof align !== 'number') throw new TypeError('Use grow to distribute stack space')
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

// Both axes use the same packing and allocation. Text makes the fill/stretch order
// significant: a column establishes its shared width before allocating heights;
// a row allocates widths before finding the height of its reflowed children.
// A measured cross axis is selected once, without percentage feedback or search.
function stack_layout(props: StackProps, query: LayoutQuery, main: Axis,
  reference = definite_reference(query.request, query.sizing)): Fragment {
  if (props.wrap) {
    if (main !== 'width') throw new TypeError('Only horizontal stacks support wrap')
    if (query.request.width.kind !== 'natural') return wrap_stack(props, query)
  }
  const cross = main === 'width' ? 'height' : 'width'
  const align = stack_alignment(props.align ?? 'start', main, `${query.measure.path}.align`)
  const gap = nonnegative(resolve_length(props.gap ?? 0, query.measure, reference[main], 'gap'), `${query.measure.path}.gap`)
  // Gaps are reserved like padding: child fractions along the main axis refer
  // to the length the children can occupy, so fractions summing to one tile it.
  const elements = element_children(props.children)
  const gaps = Math.max(0, elements.length - 1) * gap
  const inner: ReferenceBox = reference[main] === undefined ? reference
    : Object.freeze({ ...reference, [main]: Math.max(0, reference[main] - gaps) })
  const items = elements.map((element, index) =>
    stack_item(element, index, main, query, inner, align))
  const fills = (item: Item) => item.align !== 'baseline' && fills_axis(item.align, item.sizing[cross])
  const stretching = items.some(fills)

  const offer = query.request[cross]
  const cross_offer = offer.kind === 'exact' ? available(offer.value) : offer
  let cross_size = reference[cross]
  function cross_request(item: Item): AxisRequest {
    return aligned_request(cross_offer, cross_size, item.align === 'baseline' ? 0 : item.align, item.sizing[cross])
  }
  function cross_fits(item: Item, fragment?: Fragment): boolean {
    const request = cross_request(item)
    return request.kind !== 'exact' || fragment?.size[cross] === request.value
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
      inner, item.index)
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
      if (fills(item) && item.basis === undefined && !cross_fits(item, item.fragment)) {
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
    return fragment?.size[main] === sizes[index] && cross_fits(item, fragment) ? fragment
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
  // A row's width allocation and baseline group are now known. Fill/stretch
  // participating children to its chosen height, without changing their widths.
  if (stretching && cross_size === undefined) {
    cross_size = size[cross]
    fragments = fragments.map((fragment, index) =>
      !fills(items[index]) || cross_fits(items[index], fragment) ? fragment
        : measure(items[index], exact(sizes[index])))
  }

  const packing = pack_stack(props.justify ?? 'start', items.length, size[main] - length, gap)
  let position = packing.offset
  const children = fragments.map((fragment, index) => {
    const align = items[index].align
    const offset = align === 'baseline' ? above - baselines[index]
      : (size[cross] - fragment.size[cross]) * (typeof align === 'number' ? align : 0)
    const point = main === 'width' ? make_point(position, offset) : make_point(offset, position)
    position += sizes[index] + packing.gap
    return place_fragment(fragment, point)
  })
  const guides = stack_guides(children)
  return make_fragment({ size, children,
    guides: baseline_items.length ? { ...guides, baseline: above } : guides })
}

// Choose line breaks from the ordinary flex bases, then let each row allocate
// its own surplus or deficit. The offer establishes percentage references, not
// a filled frame: ungrowing rows hug their contents. Give growing cards a basis
// or min_width to control wrapping.
function wrap_stack(props: StackProps, query: LayoutQuery): Fragment {
  const offer = query.request.width
  if (offer.kind === 'natural') throw new TypeError('Wrapping needs a width offer')
  const width = offer.value
  const reference = { ...definite_reference(query.request, query.sizing), width }
  const gap = nonnegative(resolve_length(props.gap ?? 0, query.measure, width, 'gap'), 'gap')
  const line_gap = props.line_gap === undefined ? gap
    : nonnegative(resolve_length(props.line_gap,
      query.measure, reference.height, 'line_gap'), 'line_gap')
  const align = stack_alignment(props.align ?? 'start', 'width', `${query.measure.path}.align`)
  type Entry = { element: Element; index: number }
  const lines: Entry[][] = []
  let line: Entry[] = []
  function occupied(entries: Entry[]): number {
    const gaps = (entries.length - 1) * gap
    // As in a single row, fractions refer to the space left after its gaps.
    const inner = { ...reference, width: Math.max(0, width - gaps) }
    return entries.reduce((total, { element, index }) => {
      const item = stack_item(element, index, 'width', query, inner, align)
      const measured = item.basis ?? query.child(element, make_request(), inner, index).size.width
      return total + Math.max(item.sizing.width.min, Math.min(item.sizing.width.max, measured))
    }, gaps)
  }
  for (const [index, element] of element_children(props.children).entries()) {
    const entry = { element, index }
    if (line.length && occupied([...line, entry]) > width + 1e-9) {
      lines.push(line)
      line = []
    }
    line.push(entry)
  }
  if (line.length) lines.push(line)
  const rows = lines.map((entries, index) => {
    // Keep the line-breaking reference while allowing the row to report only
    // its used width. Re-measuring at that width would feed back into fractions.
    const row = new HStack({ name: 'HStack', layout: (element, row_query) =>
      stack_layout(element.props as StackProps, row_query, 'width', { width }) }, {
      gap: px(gap), align: props.align, justify: props.justify,
      children: entries.map(entry => entry.element) })
    return query.child(row, make_request({ width: offer }), reference, index)
  })
  const size = finish_size(make_size(Math.max(0, ...rows.map(row => row.size.width)),
    rows.reduce((height, row) => height + row.size.height, Math.max(0, rows.length - 1) * line_gap)),
    query.request, query.sizing)
  let height = 0
  const children = rows.map((row, index) => {
    const packing = pack_stack(props.justify ?? 'start', row.children.length, size.width - row.size.width, gap)
    const fragment = make_fragment({ name: row.name, guides: row.guides, size: make_size(size.width, row.size.height),
      children: row.children.map((child, index) => place_fragment(child.fragment,
        make_point(child.offset.x + packing.offset + index * (packing.gap - gap), child.offset.y), child.transform)) })
    const placement = place_fragment(fragment, make_point(0, height))
    height += row.size.height + (index < rows.length - 1 ? line_gap : 0)
    return placement
  })
  return make_fragment({ size, children, guides: stack_guides(children) })
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
