import { count_limit, nonnegative } from '../lib/checks'
import { aligned_request, align_offset, definite_reference, resolve_alignment } from '../lib/composition'
import type { Alignment } from '../lib/composition'
import { Element, element_children } from '../engine/element'
import type { ElementProps } from '../engine/element'
import { make_fragment, place_fragment, transform_guides } from '../engine/fragment'
import { bounds_overflow, make_point, make_rect, make_size } from '../engine/geometry'
import { available, exact, make_request, finish_size, resolve_sizing } from '../engine/layout'
import { child_measure } from '../engine/pass'
import type { LayoutQuery } from '../engine/pass'
import { resolve_length } from '../engine/units'
import type { Length } from '../engine/units'

type GridTrack = Length | 'auto'
type GridProps = ElementProps & Readonly<{
  columns?: number | readonly GridTrack[]
  gap?: Length
  column_gap?: Length
  row_gap?: Length
  align?: Alignment
}>

// Columns are chosen once; rows then hug the cells measured at those widths.
// There is no feedback from row heights or the final frame into track sizing.
function grid_layout(props: GridProps, query: LayoutQuery) {
  const path = query.measure.path
  const columns = props.columns ?? 1
  const equal = typeof columns === 'number'
  if (!equal && !Array.isArray(columns)) throw new TypeError(`${path}.columns expects a count or track array`)
  const count = count_limit(equal ? columns : columns.length, `${path}.columns`)
  if (count === 0) throw new RangeError(`${path}.columns must not be empty or zero`)
  const align = resolve_alignment(props.align ?? { x: 'fill' }, `${path}.align`)
  const elements = element_children(props.children)
  const fixed = definite_reference(query.request, query.sizing)
  const offer = query.request.width
  // Like wrapping stacks, Grid commits to a finite width budget before querying
  // children. Explicit tracks may occupy less (or more) than that budget.
  const width = offer.kind === 'natural' ? fixed.width : offer.value
  function length(value: Length, basis: number | undefined, key: string) {
    if (value == null) throw new TypeError(`${path}.${key} expects a length`)
    return nonnegative(resolve_length(value, query.measure, basis, key), `${path}.${key}`)
  }
  const column_gap = length(props.column_gap ?? props.gap ?? 0, width, 'column_gap')
  const row_gap = length(props.row_gap ?? props.gap ?? 0, fixed.height, 'row_gap')
  const gaps = (count - 1) * column_gap
  const budget = width === undefined ? undefined : Math.max(0, width - gaps)
  const widths = Array.from({ length: count }, (_, c) => {
    if (equal || columns[c] === 'auto') return 0
    return length(columns[c], budget, `columns[${c}]`)
  })
  if (!elements.length) return make_fragment({ size: finish_size(make_size(), query.request, query.sizing) })

  // Only content-sized tracks need an intrinsic probe. Unknown cell dimensions
  // stay unknown: percentages cannot bootstrap their own natural track size.
  for (const [index, element] of elements.entries()) {
    const col = index % count
    if (equal ? width === undefined : columns[col] === 'auto') {
      const fragment = query.child(element, make_request(), {}, index)
      widths[col] = Math.max(widths[col], fragment.size.width)
    }
  }
  if (equal) {
    const natural_width = widths.reduce((max, value) => Math.max(max, value), 0) * count + gaps
    const selected = width ?? Math.max(natural_width, query.sizing.width.min)
    widths.fill(Math.max(0, selected - gaps) / count)
  }

  const heights = Array<number>(Math.ceil(elements.length / count)).fill(0)
  const cells = elements.map((element, index) => {
    const col = index % count, row = Math.floor(index / count)
    // Row heights are content-sized, so only the column is a percentage basis.
    // Keep that same reference during vertical fill/stretch below.
    const reference = { width: widths[col] }
    const measure = child_measure(element, query, index, reference)
    const sizing = resolve_sizing(element.props, measure)
    const self = element.props.align_self
    if (self === 'baseline') throw new TypeError(`${measure.path}.align_self: baseline alignment is available on HStack`)
    const alignment = self === undefined ? align : resolve_alignment(self, `${measure.path}.align_self`, align)
    const request = make_request({ width: aligned_request(available(widths[col]), widths[col], alignment.x, sizing.width) })
    const fragment = query.child(element, request, reference, index)
    heights[row] = Math.max(heights[row], fragment.size.height)
    return { element, fragment, sizing, alignment, reference, col, row }
  })

  function positions(sizes: readonly number[], spacing: number) {
    let position = 0
    return sizes.map(size => { const start = position; position += size + spacing; return start; })
  }
  const xs = positions(widths, column_gap), ys = positions(heights, row_gap)
  const children = cells.map((cell, index) => {
    const { element, sizing, alignment, reference, col, row } = cell
    let fragment = cell.fragment
    const vertical = sizing.height.mode === 'fill' && alignment.y !== 'stretch' ? 'fill' : alignment.y
    const height = aligned_request(available(heights[row]), heights[row], vertical, sizing.height)
    if (height.kind === 'exact' && height.value !== fragment.size.height) {
      // Lock the measured width so an aspect ratio cannot resize a column when
      // vertical alignment fills its row. Any remaining excess is overflow.
      fragment = query.child(element, make_request({ width: exact(fragment.size.width), height }), reference, index)
    }
    const offset = align_offset(make_size(widths[col], heights[row]), fragment.size, alignment)
    return place_fragment(fragment, make_point(xs[col] + offset.x, ys[row] + offset.y))
  })
  const extent = make_size(widths.reduce((sum, value) => sum + value, gaps),
    heights.reduce((sum, value) => sum + value, (heights.length - 1) * row_gap))
  const size = finish_size(extent, query.request, query.sizing)
  const first = children.find(child => Object.keys(child.fragment.guides).length)
  const guides = first ? transform_guides(first.fragment.guides, first.offset.y) : {}
  const last = children.findLast(child => child.fragment.guides.last_baseline !== undefined
    || child.fragment.guides.baseline !== undefined)
  const baseline = last?.fragment.guides.last_baseline ?? last?.fragment.guides.baseline
  return make_fragment({ size, children,
    overflow: bounds_overflow(size, make_rect(0, 0, extent.width, extent.height)),
    guides: { ...guides, ...(last && baseline !== undefined ? { last_baseline: last.offset.y + baseline } : {}) } })
}

class Grid extends Element<GridProps> {
  static layout = grid_layout
}

export { Grid }
export type { GridProps, GridTrack }
