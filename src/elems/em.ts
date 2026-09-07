// em layout: elements carrying em metrics (see lib/em.ts) and the layouts that
// compose them. The math elements build on these with their own spacing rules
// and styles; the Text* elements with theirs

import { max, merge_limits, ensure_pair } from '../lib/utils'
import { DEFAULT_EM, make_em, text_em, bounds_em, em_bounds, em_aspect, em_rect, hull_overhang, scale_em_spec } from '../lib/em'
import type { EmSpec, EmMetrics } from '../lib/em'
import type { TextMetrics } from '../lib/text'
import type { Attrs, Rect, Limit, Align } from '../lib/types'

import { Context, Element, Group } from './core'
import { pack_layout } from './sizing'

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
    if (element.spec.width != null || element.spec.height != null) return element.layout().em
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
// row and column
//

type EmLayout = {
    children: Element[]
    metrics: EmMetrics
    coord?: Rect
    aspect?: number
}

// horizontal concatenation: widths accumulate left to right and every child's
// anchor sits on y = 0
function layout_em_row(items: WithEm[]): EmLayout {
    return pack_layout(items.map(elem => elem.spec.width != null || elem.spec.height != null ? elem.layout() : { elem, em: elem.em }), { valign: 'anchor' })
}

type EmColOptions = {
    justify?: Align
    spacing?: number
    anchor?: 'center' | 'first'  // the column's anchor: its middle (math) or its first child's (text)
}

// vertical stacking in a top-origin frame, each child keeping its own anchor line
function layout_em_col(items: WithEm[], { justify = 'center', spacing = 0, anchor = 'center' }: EmColOptions = {}): EmLayout {
    return pack_layout(items.map(elem => elem.spec.width != null || elem.spec.height != null ? elem.layout() : { elem, em: elem.em }), {
        direc: 'v', justify: ensure_pair(justify)[0], gap: spacing, anchor,
    })
}

//
// exports
//

export { ensure_em_spec, with_em, ensure_em, scale_em, em_context, place_items, layout_em_row, layout_em_col }
export type { WithEm, Placed, EmLayout, EmColOptions }
