// the layout engine: how a stack lays out children that answer the layout
// protocol (see elems/core.ts, Element.bounds and Element.lay). everything
// here is in the stack's em, the unit its children report in; the stack
// element (elems/layout.ts) turns the placements into rects
//
// a child's bounds are the sizes it can come out at, a [min, max] range per
// axis (max may be Infinity), plus an aspect when its width follows from its
// height and back as w - ox = aspect * (h - oy): a shape's ray through the
// origin, shifted by an offset once padding or gaps surround it, so the
// relation survives composition. the classification a stack needs falls out:
//
//   fixed on an axis     min == max          a formula, text with a width
//   tied                 aspect != null      width from height or back
//   flexible in height   max height == Inf   takes a height budget
//   growable             flexible, no aspect takes slack (a bare stretch)
//   content-sized        max height finite   height follows from width
//
// a child with a `share` is that fraction of the stack's length; `spacing` is
// the fraction between children. both resolve once the length is known, and
// when it is not the stack solves for it

import { make_em } from './em'
import type { EmSpec } from './em'
import type { AlignValue, Attrs, Orient } from './types'

//
// types
//

type Range = [ number, number ]

interface Bounds {
    width: Range
    height: Range
    aspect?: number
    offset?: [ number, number ]   // [ox, oy] of the tie; the origin when absent
}

// what a child is offered: a width and/or height in the stack's em, the text
// alignment and the font and text settings for children that lay themselves
// out again
interface Offer {
    width?: number
    height?: number
    fill?: boolean        // the width offered is the child's box (a row's flexible child takes its allocation)
    fit?: boolean         // the child is fit into the slot afterwards (a box's content): text that does not fit scales rather than overflows
    justify?: AlignValue
    attr?: Attrs
}

// the element to place and its box in the stack's em
interface Laid<T = unknown> {
    elem: T
    em: EmSpec
}

// what a stack asks of a child
interface LayoutItem<T> {
    bounds(): Bounds
    lay(offer?: Offer): Laid<T>
    readonly share?: number
    readonly align?: [ AlignValue | undefined, AlignValue | undefined ]
}

// how a row's children align across it: their tops, their anchors (the math
// axis of a text block's first line or of a formula), their middles, or their
// bottoms
type RowAlign = 'top' | 'anchor' | 'center' | 'bottom' | number

interface StackOptions {
    width?: number
    height?: number
    hug?: boolean         // the box hugs the children across the stack (a column's width, a row's width) rather than spanning the width offered
    gap?: number          // between children, in em
    spacing?: number      // between children, as a fraction of the stack's length
    justify?: AlignValue  // across a column, and along a row narrower than its width
    valign?: RowAlign     // across a row
    anchor?: 'first' | 'center'
    attr?: Attrs
}

interface Placement<T> {
    laid: Laid<T>
    x: number   // top left of the box, in the stack's em
    y: number
}

interface StackLayout<T> {
    placed: Placement<T>[]
    width: number
    height: number
    anchor: number
}

//
// helpers
//

const EPS = 1e-9
const INF = Infinity

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), -INF)
const range = (n: number) => Array.from({ length: n }, (_, i) => i)
const clamp = (x: number, [ lo, hi ]: Range) => Math.min(Math.max(x, lo), hi)

function frac(a: AlignValue | 'anchor' | undefined, fallback: number = 0): number {
    if (a == null) return fallback
    if (typeof a == 'number') return a
    if (a == 'left' || a == 'top') return 0
    if (a == 'center' || a == 'middle') return 0.5
    if (a == 'right' || a == 'bottom') return 1
    return fallback
}

// the tie: the width at a height and the height at a width, within the ranges
function tie_width(b: Bounds, h: number): number {
    const [ ox, oy ] = b.offset ?? [ 0, 0 ]
    return clamp(ox + b.aspect! * (h - oy), b.width)
}

function tie_height(b: Bounds, w: number): number {
    const [ ox, oy ] = b.offset ?? [ 0, 0 ]
    return clamp(oy + (w - ox) / b.aspect!, b.height)
}

const point = (x: number): Range => [ x, x ]

// bounds with nothing known: any size at all
function free_bounds(): Bounds {
    return { width: [ 0, INF ], height: [ 0, INF ] }
}

// split `total` evenly among items, each clamped to its range: the violators
// of the sign of the total violation are frozen at their clamps and the rest
// is split again (the flexbox loop)
function distribute(total: number, ranges: Range[]): number[] {
    const n = ranges.length
    const out: number[] = ranges.map(() => 0)
    const frozen: boolean[] = ranges.map(() => false)
    for (let iter = 0; iter <= n; iter++) {
        const free = range(n).filter(i => !frozen[i])
        if (free.length == 0) break
        const left = total - sum(range(n).filter(i => frozen[i]).map(i => out[i]))
        const share = left / free.length
        const clamped = (i: number) => clamp(share, ranges[i])
        const viol = sum(free.map(i => clamped(i) - share))
        const bad = free.filter(i => viol > EPS ? clamped(i) > share + EPS : viol < -EPS ? clamped(i) < share - EPS : false)
        if (bad.length == 0) {
            for (const i of free) out[i] = share
            break
        }
        for (const i of bad) { out[i] = clamped(i); frozen[i] = true }
    }
    return out
}

//
// composition
//

// what is left of a stack's length for the children without a share, once
// the shares and the fractional spacing come off the top
function stack_rest<T>(items: LayoutItem<T>[], spacing: number): number {
    return 1 - sum(items.map(k => k.share ?? 0)) - spacing * Math.max(items.length - 1, 0)
}

// the bounds of a stack from its children's: across the stack, the max over
// children; along it, the unshared children's sum plus the em gaps, scaled up
// by what the shares and the spacing take, and a shared child bounds the
// length through its fraction. the tie: unshared tied children compose
// (shared ones fit inside their fraction), a column as
// h = (w * sum(1/a_i) + sum(oy_i - ox_i/a_i) + gaps) / rest, a row likewise
// with widths; with every child shared, the tightest one fills the stack
function stack_bounds<T>(direc: Orient, items: LayoutItem<T>[], { gap = 0, spacing = 0 }: StackOptions = {}): Bounds {
    const n = items.length
    const B = items.map(k => k.bounds())
    const F = items.map(k => k.share)
    const emgaps = gap * Math.max(n - 1, 0)
    const D = stack_rest(items, spacing)
    const unshared = range(n).filter(i => F[i] == null)
    const shared = range(n).filter(i => F[i] != null)
    const along = (f: (b: Bounds) => Range): Range => {
        const scale = (x: number) => D > EPS ? x / D : (x > 0 ? INF : 0)
        let lo = scale(sum(unshared.map(i => f(B[i])[0])) + emgaps)
        let hi = unshared.length > 0 ? scale(sum(unshared.map(i => f(B[i])[1])) + emgaps) : INF
        for (const i of shared) {
            lo = Math.max(lo, f(B[i])[0] / F[i]!)
            hi = Math.min(hi, f(B[i])[1] / F[i]!)
        }
        return [ lo, Math.max(hi, lo) ]
    }
    const across = (f: (b: Bounds) => Range): Range => n > 0 ? [ max(B.map(b => f(b)[0])), max(B.map(b => f(b)[1])) ] : [ 0, 0 ]
    const off = (b: Bounds) => b.offset ?? [ 0, 0 ]
    const vertical = direc == 'v'
    let tie: { aspect?: number, offset?: [ number, number ] } = {}
    if (unshared.length > 0 && unshared.every(i => B[i].aspect != null) && D > EPS) {
        const U = unshared.map(i => B[i])
        tie = vertical
            ? { aspect: D / sum(U.map(b => 1 / b.aspect!)), offset: [ 0, (sum(U.map(b => off(b)[1] - off(b)[0] / b.aspect!)) + emgaps) / D ] }
            : { aspect: sum(U.map(b => b.aspect!)) / D, offset: [ (sum(U.map(b => off(b)[0] - b.aspect! * off(b)[1])) + emgaps) / D, 0 ] }
    } else if (unshared.length == 0 && shared.length > 0 && shared.every(i => B[i].aspect != null)) {
        // the tightest: the largest width per length (a column) or the
        // smallest length per height (a row)
        const key = (i: number) => vertical ? B[i].aspect! * F[i]! : B[i].aspect! / F[i]!
        const j = shared.reduce((a, i) => (vertical ? key(i) > key(a) : key(i) < key(a)) ? i : a, shared[0])
        const [ ox, oy ] = off(B[j])
        tie = vertical ? { aspect: key(j), offset: [ ox, oy / F[j]! ] } : { aspect: key(j), offset: [ ox / F[j]!, oy ] }
    }
    return vertical
        ? { width: across(b => b.width), height: along(b => b.height), ...tie }
        : { width: along(b => b.width), height: across(b => b.height), ...tie }
}

// the bounds of a box around one child: the child's shifted by the insets
// (the ranges, and the tie's offset)
// the one width at which tied children stacked in a column come to a height:
// sum(oy_i + (w - ox_i) / a_i) = height
function tied_width(B: Bounds[], height: number): number {
    const off = (b: Bounds) => b.offset ?? [ 0, 0 ]
    return (height - sum(B.map(b => off(b)[1])) + sum(B.map(b => off(b)[0] / b.aspect!))) / sum(B.map(b => 1 / b.aspect!))
}

function box_bounds(child: Bounds, [ ix, iy ]: [ number, number ]): Bounds {
    const [ ox, oy ] = child.offset ?? [ 0, 0 ]
    const tie = child.aspect != null ? { aspect: child.aspect, offset: [ ox + ix, oy + iy ] as [ number, number ] } : {}
    return { width: [ child.width[0] + ix, child.width[1] + ix ], height: [ child.height[0] + iy, child.height[1] + iy ], ...tie }
}

// bounds in a child's em scaled into its parent's
function scale_bounds(b: Bounds, s: number): Bounds {
    const sc = ([ lo, hi ]: Range): Range => [ lo * s, hi * s ]
    const offset = b.offset != null ? [ b.offset[0] * s, b.offset[1] * s ] as [ number, number ] : undefined
    return { width: sc(b.width), height: sc(b.height), aspect: b.aspect, offset }
}

//
// stacks
//

// a column hands its width to every unshared child (height follows) and
// finds its height: given, or what those children need scaled up by the
// shares and spacing (all shared: the tightest tied child fills the width).
// given a height, the shares and spacing come off the top and, of the rest,
// the growable children take what the figures leave; over budget every
// flexible child shrinks by one factor, the tied ones narrowing together to a
// common width and the growables from their height at the width, none below
// its minimum; content children (text) never change and overflow honestly. a
// shared child gets its fraction of the height. with no
// width, content children are at their natural size, the tied ones span the
// one width that spends the budget (solved from their ties), or with no
// budget either the column is as wide as its widest child and lays every
// child out for that
function layout_column<T>(items: LayoutItem<T>[], options: StackOptions): StackLayout<T> {
    const { width: W0, height: H0, hug = false, gap = 0, spacing = 0, justify = 'left', anchor: anchor0 = 'first', attr } = options
    const offer = (k: LayoutItem<T>, size: { width?: number, height?: number }): Laid<T> => k.lay({ ...size, justify, attr })
    const n = items.length
    const B = items.map(k => k.bounds())
    const F = items.map(k => k.share)
    const D = stack_rest(items, spacing)
    const emgaps = gap * Math.max(n - 1, 0)
    const unshared = range(n).filter(i => F[i] == null)
    const shared = range(n).filter(i => F[i] != null)
    const flexible = unshared.filter(i => B[i].height[1] == INF)
    const grow = flexible.filter(i => B[i].aspect == null)
    const laid: Laid<T>[] = items.map(() => null!)
    let W: number
    let H = H0

    // no width and no budget: the widest child at its natural size sets the
    // width, and everything is laid out for it
    if (W0 == null && H == null) {
        const natural = items.map((k, i) => F[i] == null && B[i].aspect == null && B[i].width[1] == INF ? null : offer(k, {}))
        const widths = natural.map(l => l?.em.width ?? 0)
        W = n > 0 ? Math.max(max(widths), 0) : 0
    } else {
        W = W0!
    }

    if (W0 != null || H == null) {
        unshared.forEach(i => { laid[i] = offer(items[i], { width: W }) })
        const need = sum(unshared.map(i => laid[i].em.height)) + emgaps

        // the height the content comes to, with the shares and spacing
        // taken as fractions of it (all shared: the tightest tied child
        // fills the width); a height offered is a budget, and becomes the
        // box only when something can use it: a growable child takes the
        // slack, or the content overflows it and the flexible children give
        // way. otherwise the column hugs its content
        let natural: number
        if (unshared.length > 0) {
            natural = D > EPS ? need / D : need
        } else {
            const tied = shared.filter(i => B[i].aspect != null)
            natural = tied.length > 0 ? Math.min(...tied.map(i => tie_height(B[i], W) / F[i]!))
                : shared.length > 0 ? max(shared.map(i => offer(items[i], { width: W }).em.height / F[i]!)) : 0
        }
        if (H == null || (grow.length == 0 && (flexible.length == 0 || natural <= H + EPS))) {
            H = natural
        } else {
            // the budget for the unshared children and the em gaps
            const budget = H * D
            if (need < budget - EPS && grow.length > 0) {
                // the growable children split the slack; one that comes up
                // short of its target (a row whose figure hit the width) is
                // frozen there and the rest is split again
                const total = sum(grow.map(i => laid[i].em.height)) + (budget - need)
                const ranges = grow.map(i => B[i].height)
                for (let iter = 0; iter <= grow.length; iter++) {
                    const targets = distribute(total, ranges)
                    grow.forEach((i, j) => { laid[i] = offer(items[i], { width: W, height: targets[j] }) })
                    const short = grow.map((i, j) => laid[i].em.height < targets[j] - EPS)
                    if (!short.some(s => s)) break
                    grow.forEach((i, j) => { if (short[j]) ranges[j] = [ laid[i].em.height, laid[i].em.height ] })
                }
            } else if (need > budget + EPS && flexible.length > 0) {
                // over the budget, the growable children take what the
                // content and the figures leave (split evenly, clamped to
                // their ranges). if the figures alone do not fit, every
                // flexible child shrinks by one factor s: a tied child to the
                // common width s W (as the column would be fit at its
                // aspect), a growable from its height at the width, floored
                // at its minimum (floored children are frozen and s re-solved)
                const tied = flexible.filter(i => B[i].aspect != null)
                const content = sum(unshared.filter(i => !flexible.includes(i)).map(i => laid[i].em.height)) + emgaps
                const figures = sum(tied.map(i => laid[i].em.height))
                const left = budget - content
                const floors = grow.map(i => B[i].height[0])
                if (left - figures >= sum(floors) - EPS) {
                    const targets = distribute(left - figures, grow.map(i => B[i].height))
                    grow.forEach((i, j) => { laid[i] = offer(items[i], { width: W, height: targets[j] }) })
                } else {
                    const off = (b: Bounds) => b.offset ?? [ 0, 0 ]
                    const base = sum(tied.map(i => off(B[i])[1] - off(B[i])[0] / B[i].aspect!))
                    const slope_tied = sum(tied.map(i => W / B[i].aspect!))
                    const heights = grow.map(i => laid[i].em.height)
                    const floored = grow.map(() => false)
                    let s = 0
                    for (let iter = 0; iter <= grow.length; iter++) {
                        const frozen = sum(grow.map((_, j) => floored[j] ? floors[j] : 0))
                        const slope = slope_tied + sum(grow.map((_, j) => floored[j] ? 0 : heights[j]))
                        s = slope > EPS ? Math.min(Math.max((left - base - frozen) / slope, 0), 1) : 0
                        const newly = grow.map((_, j) => !floored[j] && s * heights[j] < floors[j] - EPS)
                        if (!newly.some(x => x)) break
                        newly.forEach((x, j) => { if (x) floored[j] = true })
                    }
                    tied.forEach(i => { laid[i] = offer(items[i], { width: s * W }) })
                    grow.forEach((i, j) => { laid[i] = offer(items[i], { width: W, height: Math.max(s * heights[j], floors[j]) }) })
                }
            }
        }
        shared.forEach(i => { laid[i] = offer(items[i], { width: W, height: F[i]! * H! }) })
    } else {
        // a budget and no width: content at its natural size, the tied
        // children at the one width whose heights spend what is left:
        // sum(oy_i + (W - ox_i) / a_i) = left
        const ti = flexible.filter(i => B[i].aspect != null)
        unshared.filter(i => !ti.includes(i)).forEach(i => { laid[i] = offer(items[i], {}) })
        shared.forEach(i => { laid[i] = offer(items[i], { height: F[i]! * H! }) })
        if (ti.length > 0) {
            const left = H! - sum(laid.map(l => l?.em.height ?? 0)) - emgaps - spacing * Math.max(n - 1, 0) * H!
            const Wt = tied_width(ti.map(i => B[i]), left)
            ti.forEach(i => { laid[i] = offer(items[i], { width: Math.max(Wt, 0) }) })
        }
        W = n > 0 ? max(laid.map(l => l.em.width)) : 0
        grow.forEach(i => { laid[i] = offer(items[i], { width: W, height: laid[i].em.height }) })
    }

    // the box: the width offered (or the widest child if wider), or hugging
    // the widest child, which is the offered width when any child spans it.
    // place down the column, each child across the box by justify (or its
    // own align), the gap in em plus the fraction of the height; a shared
    // child takes its slot and sits in the middle of it
    const widest = n > 0 ? max(laid.map(l => l.em.width)) : 0
    const width = hug ? widest : Math.max(W, widest)
    const step = gap + spacing * (H ?? 0)
    let y = 0
    const placed = laid.map((l, i) => {
        if (i > 0) y += step
        const slot = F[i] != null && H != null ? F[i]! * H : l.em.height
        const x = frac(items[i].align?.[0] ?? justify) * (width - l.em.width)
        const p = { laid: l, x, y: y + 0.5 * (slot - l.em.height) }
        y += slot
        return p
    })
    const anchor = anchor0 == 'center' ? 0.5 * y : n > 0 ? placed[0].y + laid[0].em.anchor : 0
    return { placed, width, height: y, anchor }
}

// a row gives fixed children their width, shared ones their fraction of it,
// and splits the rest evenly among the flexible ones, clamped to their
// ranges. given a height too, tied children are sized by it (their tie), and
// give way toward their fair share of the width until the other children fit
// the height and they fit the width themselves (a bisection, since content
// heights depend on the tied children's widths). with no width every unshared child is at its natural
// size for the height (text finds the narrowest width that fits) and the
// width is what they need scaled up by the shares and spacing (all shared:
// the tightest tied child fills the height). the row is as tall as its
// tallest child once aligned by valign (or a child's own align), growable
// children stretch to it, and a row narrower than its width sits along it
// by justify
function layout_row<T>(items: LayoutItem<T>[], options: StackOptions): StackLayout<T> {
    const { width: W0, height: H, hug = false, gap = 0, spacing = 0, justify = 'left', valign = 'top', anchor: anchor0 = 'first', attr } = options
    const offer = (k: LayoutItem<T>, size: { width?: number, height?: number, fill?: boolean }): Laid<T> => k.lay({ ...size, justify, attr })
    const n = items.length
    const B = items.map(k => k.bounds())
    const F = items.map(k => k.share)
    const D = stack_rest(items, spacing)
    const emgaps = gap * Math.max(n - 1, 0)
    const unshared = range(n).filter(i => F[i] == null)
    const shared = range(n).filter(i => F[i] != null)
    const grow = B.map((b, i) => F[i] == null && b.height[1] == INF && b.aspect == null)
    let laid: Laid<T>[]
    let slots: (number | null)[] = items.map(() => null)   // the width allocated to each child, when the row has one to divide
    let W = W0
    if (W != null) {
        const Wr = W
        const fixed = B.map((b, i) => F[i] != null ? F[i]! * Wr : b.width[0] == b.width[1] ? b.width[0] : null)
        const free = range(n).filter(i => fixed[i] == null)
        const aspects = free.filter(i => B[i].aspect != null && H != null)
        const flex = free.filter(i => !aspects.includes(i))
        const avail = Wr - emgaps - spacing * Math.max(n - 1, 0) * Wr - sum(fixed.map(w => w ?? 0))

        // the fair shares of the free children, and the full-height widths
        // of the tied ones (no wider than leaves the rest their minimum)
        const shares = distribute(avail, free.map(i => B[i].width))
        const share = (i: number) => shares[free.indexOf(i)]
        const room = avail - sum(flex.map(i => B[i].width[0]))
        const full = aspects.map(i => Math.min(tie_width(B[i], H!), Math.max(room, 0)))

        // lay for a point between fair share (0) and full height (1)
        const layAt = (f: number): { laid: Laid<T>[], ws: number[], fits: boolean } => {
            const aw = aspects.map((i, j) => full[j] > share(i) ? share(i) + f * (full[j] - share(i)) : full[j])
            const fw = distribute(avail - sum(aw), flex.map(i => B[i].width))
            const ws = range(n).map(i => fixed[i] ?? (aspects.includes(i) ? aw[aspects.indexOf(i)] : fw[flex.indexOf(i)]))
            const out = items.map((k, i) => offer(k, { width: ws[i], height: H, fill: flex.includes(i) || F[i] != null }))
            const fits = flex.every(i => out[i].em.height <= H! + EPS) && sum(aw) <= avail + EPS
            return { laid: out, ws, fits }
        }
        const seek = aspects.some((i, j) => full[j] > share(i))
        let at: { laid: Laid<T>[], ws: number[], fits: boolean }
        if (!seek) {
            at = layAt(1)
        } else {
            at = layAt(1)
            if (!at.fits) {
                const at0 = layAt(0)
                if (!at0.fits) {
                    at = at0
                } else {
                    at = at0
                    let lo = 0, hi = 1
                    for (let i = 0; i < 40; i++) {
                        const mid = (lo + hi) / 2
                        const mid_at = layAt(mid)
                        if (mid_at.fits) { lo = mid; at = mid_at } else hi = mid
                    }
                }
            }
        }
        laid = at.laid
        // a flexible child keeps the slot it was allocated (its content sits
        // in it by its own align); fixed and tied children are their size
        flex.forEach(i => { slots[i] = at.ws[i] })
    } else {
        laid = items.map(() => null!)
        unshared.forEach(i => { laid[i] = offer(items[i], { height: H }) })
        const need = sum(unshared.map(i => laid[i].em.width)) + emgaps
        if (unshared.length > 0) {
            W = D > EPS ? need / D : need
        } else if (H != null) {
            const tied = shared.filter(i => B[i].aspect != null)
            W = tied.length > 0 ? Math.min(...tied.map(i => tie_width(B[i], H) / F[i]!))
                : shared.length > 0 ? max(shared.map(i => offer(items[i], { height: H }).em.width / F[i]!)) : 0
        } else {
            W = shared.length > 0 ? max(shared.map(i => offer(items[i], {}).em.width / F[i]!)) : 0
        }
        const Wr = W
        shared.forEach(i => { laid[i] = offer(items[i], { width: F[i]! * Wr, height: H, fill: true }) })
    }

    // the row's height is its content's (a height offered is a budget the
    // children were sized by, not the row's box); growable children stretch
    // to it when no height was offered
    let height = n > 0 ? max(laid.map(l => l.em.height)) : 0
    if (H == null) range(n).filter(i => grow[i]).forEach(i => { laid[i] = offer(items[i], { width: laid[i].em.width, height }) })

    // align across: by valign, or a child's own; 'anchor' lines the anchors up
    const anchor_line = n > 0 ? max(laid.map(l => l.em.anchor)) : 0
    const ys = laid.map((l, i) => {
        const a = items[i].align?.[1] ?? valign
        return a == 'anchor' ? anchor_line - l.em.anchor : frac(a as AlignValue) * (height - l.em.height)
    })
    height = Math.max(height, ...laid.map((l, i) => ys[i] + l.em.height))

    // place along, the gap in em plus the fraction of the width. a shared
    // child takes its fraction as its slot and sits in the middle of it, a
    // flexible one the width it was allocated and sits in it by its own
    // align (or flush left); a row narrower than its width sits along it by
    // justify, or hugs what it packed
    const step = gap + spacing * (W ?? 0)
    const slot_of = (i: number) => F[i] != null && W != null ? F[i]! * W : Math.max(slots[i] ?? 0, laid[i].em.width)
    const packed = sum(range(n).map(slot_of)) + step * Math.max(n - 1, 0)
    const width = hug ? packed : Math.max(W ?? 0, packed)
    let x = frac(justify) * Math.max(width - packed, 0)
    const placed = laid.map((l, i) => {
        if (i > 0) x += step
        const slot = slot_of(i)
        const inset = F[i] != null ? 0.5 : frac(items[i].align?.[0], 0)
        const p = { laid: l, x: x + inset * (slot - l.em.width), y: ys[i] }
        x += slot
        return p
    })
    const anchor = anchor0 == 'center' ? 0.5 * height : n > 0 ? placed[0].y + laid[0].em.anchor : 0
    return { placed, width, height, anchor }
}

function layout_stack<T>(direc: Orient, items: LayoutItem<T>[], options: StackOptions = {}): StackLayout<T> {
    return direc == 'v' ? layout_column(items, options) : layout_row(items, options)
}

//
// exports
//

export { INF, EPS, point, free_bounds, tie_width, tie_height, distribute, stack_rest, stack_bounds, box_bounds, scale_bounds, layout_stack, layout_column, layout_row, frac as align_fraction, make_em }
export type { Range, Bounds, Offer, Laid, LayoutItem, RowAlign, StackOptions, Placement, StackLayout }
