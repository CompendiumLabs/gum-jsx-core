// em layout: elements carrying em metrics (see lib/em.ts) and the layouts that
// compose them. The text stacks (TextStack, TextCol, TextRow) and the math
// stacks (MathRow, MathCol) are both layout_em_stack with their own defaults;
// math adds its spacing rules and styles, text its wrapping

import { sum, max, merge_limits, ensure_pair } from '../lib/utils'
import { DEFAULT_EM, make_em, text_em, bounds_em, em_bounds, em_aspect, em_rect, hull_overhang, scale_em_spec } from '../lib/em'
import type { EmSpec, EmMetrics } from '../lib/em'
import type { TextMetrics } from '../lib/text'
import type { Attrs, Rect, Limit, Align, AlignValue, Orient } from '../lib/types'

import { Context, Element, Group, align_frac } from './core'
import type { Laid } from './core'

//
// elements with metrics
//

type WithEm<E extends Element = Element> = E & {
    em: EmSpec
}

// A shared, immutable recipe for reconstruction. Placement clones copy its
// reference; successive patches merge into one record rather than a chain.
const EM_ADAPTATION = Symbol('em adaptation')
type EmNormalizer = (spec: Partial<EmSpec>) => EmSpec
type EmAdaptation = { readonly rebuild: Element['rebuild'], readonly patch: Readonly<Partial<EmSpec>>, readonly normalize: EmNormalizer }
type AdaptedEm<E extends Element = Element> = WithEm<E> & { [EM_ADAPTATION]?: EmAdaptation }

function rebuild_em(this: AdaptedEm, args: Attrs): Element {
    const adaptation = this[EM_ADAPTATION]!
    const out = adaptation.rebuild.call(this, args) as AdaptedEm
    const em = out.em ?? ensure_em_spec(out)
    out.em = adaptation.normalize({ ...em, ...adaptation.patch })
    out[EM_ADAPTATION] = adaptation
    out.rebuild = rebuild_em
    return out
}

// the metrics an element without any gets: a Span's from its text box,
// anything else a one-em box as wide as its aspect
function ensure_em_spec(element: Element): EmMetrics {
    const metrics = (element as { metrics?: TextMetrics }).metrics
    if (metrics != null) return text_em(metrics)
    const { width, height, anchor } = DEFAULT_EM
    return { width: element.spec.aspect ?? width, height, anchor }
}

// Explicit overrides survive reconstruction; unpatched fields are measured
// again by the constructor. A subtype can supply its own metric defaults.
function with_em<E extends Element>(element: E, patch: Partial<EmSpec> = {}, args: Attrs = {}, normalize?: EmNormalizer): WithEm<E> {
    const out = element.clone(args) as AdaptedEm<E>
    const adaptation = out[EM_ADAPTATION]
    const em0 = out.em
    const em = em0 ?? ensure_em_spec(out)
    const make = normalize ?? adaptation?.normalize ?? make_em
    out.em = make({ ...em, ...patch })

    const patched = Object.keys(patch).length > 0
    if (patched || em0 == null || (normalize != null && normalize !== adaptation?.normalize)) {
        out[EM_ADAPTATION] = {
            rebuild: adaptation?.rebuild ?? out.rebuild,
            patch: { ...adaptation?.patch, ...patch },
            normalize: make,
        }
        out.rebuild = rebuild_em
    }
    return out
}

function ensure_em<E extends Element>(element: E): WithEm<E> {
    if ((element as WithEm<E>).em != null) return element as WithEm<E>
    return with_em(element)
}

// scale an element's metrics uniformly: content laid out in a smaller em is
// reported in its parent's, and rendering follows the metrics
function scale_em<E extends Element>(element: WithEm<E>, scale: number): WithEm<E> {
    if (scale == 1) return element
    return with_em(element, scale_em_spec(element.em, scale))
}

// a context whose stroke unit is this box's pixels per em, so a stroke_width
// in em is the same rule at any font size
function em_context(ctx: Context): Context {
    return ctx.clone({ unit: Math.abs(ctx.resizex(1, false)) })
}

//
// explicit placement
//

// an item placed with its anchor at (x, y) in a shared anchor frame; `align`
// centers or justifies it within a rect of the given width
type Placed = {
    item: WithEm
    x: number
    y: number
    width?: number
    align?: Align
}

// assemble explicitly placed items into a group whose anchor is at y = 0 and
// whose box is the union of the placed boxes (optionally padded), or the given
// width when some items are not to count (an accent glyph)
function place_items(placed: Placed[], pad: Limit = [ 0, 0 ], width0?: number): WithEm<Group> {
    // an item given a width is justified within it; otherwise it draws in its
    // own ink box, which may overhang its layout box
    const rects = placed.map(({ item, x, y, width }) => {
        const [ x1, y1, x2, y2 ] = em_rect(item.em, x, y)
        return (width != null ? [ x, y1, x + width, y2 ] : [ x1, y1, x2, y2 ]) as Rect
    })
    const children = placed.map(({ item, align }, i) =>
        with_em(item, {}, { rect: rects[i], ...(align != null ? { align } : {}) })
    )

    // the layout box is the union of the layout boxes
    const width = width0 ?? max(placed.map(({ item, x, width }) => x + (width ?? item.em.width))) ?? 0
    const [ ylo0, yhi0 ] = merge_limits(placed.map(({ item, y }) => {
        const [ lo, hi ] = em_bounds(item.em)
        return [ y + lo, y + hi ] as Limit
    }))
    const bounds: Limit = [ ylo0 - pad[0], yhi0 + pad[1] ]

    // the group draws the ink hull, which the layout box may not cover
    const { hink, vink, coord } = hull_overhang(rects, width, bounds)
    const metrics = bounds_em(width, bounds, { hink, vink })
    const group = new Group({ children, coord, aspect: em_aspect(metrics), env: placed[0]?.item.env })
    return with_em(group, metrics)
}

//
// stack
//

// a laid child with the top left of its box at (x, y) in a container's em frame
function place_laid({ elem, em }: Laid, x: number, y: number): Element {
    return elem.clone({ rect: em_rect(em, x, y + em.anchor) })
}

// a laid child's own `align`, as [ horizontal, vertical ]: it overrides the
// container's justify (in a column or grid cell) or valign (in a row) for
// that child alone
function child_align({ elem }: Laid): [ AlignValue | undefined, AlignValue | undefined ] {
    const align = elem.spec.align
    return align != null ? ensure_pair(align) : [ undefined, undefined ]
}

// the vertical offsets that align laid children in a row: by their tops,
// their anchors, their middles or their bottoms, or a child's own align
type RowAlign = 'top' | 'anchor' | 'center' | 'bottom'

function row_offsets(laid: Laid[], valign: RowAlign): number[] {
    const height = max(laid.map(l => l.em.height)) ?? 0
    const anchor = max(laid.map(l => l.em.anchor)) ?? 0
    return laid.map(l => {
        const align = child_align(l)[1] ?? valign
        return align == 'anchor' ? anchor - l.em.anchor : align_frac(align as AlignValue) * (height - l.em.height)
    })
}

function box_aspect(width: number, height: number): number | undefined {
    return (width > 0 && height > 0) ? width / height : undefined
}

type EmStackOptions = {
    width?: number
    height?: number
    gap?: number
    sizes?: number[]
    justify?: AlignValue
    valign?: RowAlign
    anchor?: 'first' | 'center'
    attr?: Attrs
}

type EmLayout = {
    children: Element[]
    coord: Rect
    aspect: number | undefined
    metrics: EmMetrics
}

// a stack laid out in em: every child is laid for its slot (see Element.lay)
// and they are packed along the axis, `gap` em apart, and aligned across it.
// the layout reports its box in em like any measured element, so stacks nest
//
// a column offers its `width` to every child: text takes it (unless it has a
// width of its own), a formula keeps its size, and a bare element spans it at
// its aspect. with no width, children are laid at their own sizes and the
// column is as wide as the widest. given a `height`, it is a budget: the children sized
// by the width are laid first and what is left is split evenly among the
// height-flexible ones (see Element.flex_height), each sized to its share
// instead of spanning the width. the column's box is its content, anchored
// on its first child (`anchor: 'first'`, text) or its middle (`'center'`,
// math)
//
// a row offers slots along its `width`: fixed children (see Element.fixed)
// keep their size and the rest share what is left, or `sizes` splits the
// width as given; with no width, every child is at its own size. a `height`
// is handed down to the children that budget one (a nested stack) and sizes
// a bare element to it at its aspect, no wider than the row. the children
// align across the row by `valign` and a row narrower than its width is
// placed along it by `justify`
//
// in either, a child with a `stack-size` is that long along the axis, in em,
// spans the stack across, and is fit inside that box by its aspect
function layout_em_stack(direc: Orient, children: Element[], options: EmStackOptions = {}): EmLayout {
    const { width, height, gap = 0, sizes, justify = 'left', valign = 'top', anchor: anchor0 = 'first', attr = {} } = options
    const vertical = direc == 'v'
    const n = children.length
    const gaps = gap * Math.max(n - 1, 0)
    const offer = (c: Element, size: { width?: number, height?: number, span?: boolean }): Laid => c.lay({ ...size, justify, attr })

    // the sized children are their `stack-size` long; the rest are laid for
    // their slots
    const sized_em = children.map(c => c.attr.stack_size as number | undefined)
    const sized_sum = sum(sized_em.map(s => s ?? 0))
    const free = sized_em.map(s => s == null)
    const laid: (Laid | null)[] = children.map(() => null)
    let cross: number
    if (vertical) {
        // the width: given, or the widest child laid at its own size
        const natural = children.map((c, i) => (width == null && free[i] && !c.flex_height()) ? offer(c, {}) : null)
        cross = width ?? max(natural.map(l => l?.em.width).filter(w => w != null) as number[]) ?? 1

        // the children sized by the width first, then the height-flexible ones
        // get an even share of what is left of the budget
        const soft = children.map((c, i) => free[i] && height != null && c.flex_height())
        children.forEach((c, i) => {
            if (!free[i] || soft[i]) return
            laid[i] = (width != null || c.flex_height()) ? offer(c, { width: cross }) : natural[i]!
        })
        const used = sum(laid.map(l => l?.em.height ?? 0)) + gaps + sized_sum
        const nsoft = soft.filter(s => s).length
        const share = (height != null && nsoft > 0) ? (height - used) / nsoft : 0
        const each = share > 0 ? share : undefined
        children.forEach((c, i) => {
            if (soft[i]) laid[i] = offer(c, { width: cross, height: each, span: true })
        })
    } else {
        // the row's slots: by the given splits, by the children's own sizes
        // with the slack shared, or every child at its own size. a child
        // sized by the height keeps that width like a fixed one
        const slots: (number | undefined)[] = children.map(() => undefined)
        if (sizes != null && width != null) {
            const total = sum(sizes)
            children.forEach((c, i) => {
                if (free[i]) slots[i] = (sizes[i] ?? 0) / total * (width - gaps)
            })
        } else if (width != null) {
            const sized = (c: Element) => height != null && c.flex_height() && !c.reflow.includes('width')
            children.forEach((c, i) => {
                if (!free[i]) return
                if (c.fixed()) laid[i] = offer(c, { height })
                else if (sized(c)) laid[i] = offer(c, { width: width - gaps, height })
            })
            const used = sum(laid.map(l => l?.em.width ?? 0)) + sized_sum
            const flex = children.filter((c, i) => free[i] && laid[i] == null).length
            const slot = flex > 0 ? Math.max(width - gaps - used, 0) / flex : 0
            children.forEach((c, i) => {
                if (free[i] && laid[i] == null) slots[i] = slot
            })
        }
        children.forEach((c, i) => {
            if (free[i] && laid[i] == null) laid[i] = offer(c, { width: slots[i], height })
        })
        cross = 0 // the content height, found once the children are aligned
    }

    // the boxes of the sized children: their length, spanning the stack
    // across (a row's height is settled below)
    const boxes: Laid[] = children.map((c, i) => {
        if (laid[i] != null) return laid[i]!
        const size = sized_em[i]!
        const [ w, h ] = vertical ? [ cross, size ] : [ size, cross ]
        return { elem: c, em: make_em({ width: w, height: h, anchor: 0.5 * h }) }
    })

    // pack along the axis and align across it
    let rects: Rect[]
    let box_width: number
    let box_height: number
    let anchor: number
    if (vertical) {
        // a column is as tall as its content; each child is placed across it
        // by justify (or its own align)
        let y = 0
        rects = boxes.map((l, i) => {
            if (i > 0) y += gap
            const x = align_frac(child_align(l)[0] ?? justify) * (cross - l.em.width)
            const rect = em_rect(l.em, x, y + l.em.anchor)
            y += l.em.height
            return rect
        })
        box_width = cross
        box_height = y
        anchor = anchor0 == 'center' ? 0.5 * box_height : (boxes[0]?.em.anchor ?? 0)
    } else {
        // a row's height is its tallest laid child once they are aligned; the
        // sized children then span it. a row narrower than its width is
        // placed along it by justify
        const free_boxes = boxes.filter((_, i) => laid[i] != null)
        const ys = row_offsets(free_boxes, valign)
        box_height = free_boxes.length > 0 ? (max(free_boxes.map((l, j) => ys[j] + l.em.height)) ?? 0) : (height ?? 1)
        const offsets: number[] = []
        for (let i = 0, j = 0; i < n; i++) {
            if (laid[i] != null) {
                offsets.push(ys[j++])
            } else {
                boxes[i] = { elem: boxes[i].elem, em: make_em({ width: boxes[i].em.width, height: box_height, anchor: 0.5 * box_height }) }
                offsets.push(0)
            }
        }
        const packed = sum(boxes.map(l => l.em.width)) + gaps
        box_width = width ?? packed
        let x = align_frac(justify) * Math.max(box_width - packed, 0)
        rects = boxes.map((l, i) => {
            if (i > 0) x += gap
            const rect = em_rect(l.em, x, offsets[i] + l.em.anchor)
            x += l.em.width
            return rect
        })
        anchor = boxes.length > 0 ? offsets[0] + boxes[0].em.anchor : 0
    }
    const placed = boxes.map((l, i) => laid[i] != null
        ? l.elem.clone({ rect: rects[i] })
        : l.elem.clone({ rect: rects[i], align: l.elem.spec.align ?? justify, stack_size: undefined })
    )

    // the stack draws the ink hull of its children, which the box may not
    // cover (a formula with overhang); the metrics keep the box
    const { hink, vink, coord } = hull_overhang(rects, box_width, [ 0, box_height ])
    const metrics: EmMetrics = { width: box_width, height: box_height, anchor, hink, vink }
    const aspect = em_aspect(metrics)
    return { children: placed, coord, aspect, metrics }
}

//
// exports
//

export { ensure_em_spec, with_em, ensure_em, scale_em, em_context, place_items, place_laid, child_align, row_offsets, box_aspect, layout_em_stack }
export type { WithEm, Placed, RowAlign, EmStackOptions, EmLayout }
