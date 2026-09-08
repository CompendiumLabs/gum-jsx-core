// layout components

import { THEME } from '../lib/theme'
import type { Env } from '../env'
import { DEFAULTS as D, none } from '../lib/const'
import { is_scalar, ensure_vector, ensure_pair, log, exp, max, sum, zip, div2, cumsum, reshape, repeat, meshgrid, padvec, normalize, mean, aspect_invariant, check_singleton, check_array, rect_center, rect_radius, join_limits, radial_rect, norm_side, prefix_split, prefix_join, merge_points, pad_rect, rect_dims } from '../lib/utils'
import { wrapWidths } from '../lib/wrap'

import { scale_bounds } from '../lib/layout'

import { Context, Group, Element, Rectangle, Spacer, spec_split, align_frac, ensure_children } from './core'
import { RoundedRect, Dot } from './geometry'
import { layout_em_stack, layout_em_bounds, box_aspect } from './em'
import { make_em, scale_em_spec } from '../lib/em'

import type { Point, Rect, Limit, AlignValue, Side, Orient, Padding, Rounded } from '../lib/types'
import type { ElementArgs, GroupArgs, Bounds, Offer, Laid } from './core'
import type { EmArgs, EmSpec } from '../lib/em'
import type { EmStackOptions, RowAlign } from './em'

//
// padding/margin utils
//

function maybe_rounded_rect(rounded: Rounded | undefined, env?: Env): Element {
    if (rounded == null) {
        return new Rectangle({ env })
    } else {
        return new RoundedRect({ rounded, env })
    }
}

// map padding/margin into internal boxes
function apply_padding(padding: Rect, aspect0: number | undefined): { rect: Rect, aspect: number | undefined } {
    const [ pl, pt, pr, pb ] = padding
    const [ pw, ph ] = [ pl + 1 + pr, pt + 1 + pb ]
    const rect = [ pl / pw, pt / ph, 1 - pr / pw, 1 - pb / ph ] as Rect
    const aspect = (aspect0 != null) ? aspect0 * (pw / ph) : undefined
    return { rect, aspect }
}

//
// box/frame classes
//

function computeBoxLayout(children: Element[], { padding, margin, aspect, adjust = true, aspect_child: aspect_child0 }: { padding?: Padding, margin?: Padding, aspect?: number, adjust?: boolean, aspect_child?: number } = {}) : { rect_inner: Rect, rect_outer: Rect, fractions: [ number, number ], aspect_inner?: number, aspect_outer?: number } {
    // the box aspect: its own, the content's as laid out, or the first child's
    const aspect_child = aspect ?? aspect_child0 ?? children[0]?.spec?.aspect

    // handle all null case
    if (padding == null && margin == null) {
        return {
            rect_inner: D.rect, rect_outer: D.rect,
            aspect_inner: aspect_child, aspect_outer: aspect_child,
            fractions: [ 1, 1 ] as [ number, number ],
        }
    }

    // apply padding to outer rect
    let padding1 = pad_rect(padding)
    if (adjust && aspect_child != null) padding1 = aspect_invariant(padding1, 1 / aspect_child) as Rect
    const { rect: rect_inner, aspect: aspect_inner } = apply_padding(padding1, aspect_child)

    // apply margin to global rect
    let margin1 = pad_rect(margin)
    if (adjust && aspect_inner != null) margin1 = aspect_invariant(margin1, 1 / aspect_inner) as Rect
    const { rect: rect_outer, aspect: aspect_outer } = apply_padding(margin1, aspect_inner)

    // return inner/outer rects, aspect, and the content's fraction of the box
    // on each axis (inside the margin, then inside the padding)
    const [ iw, ih ] = rect_dims(rect_inner)
    const [ ow, oh ] = rect_dims(rect_outer)
    const fractions: [ number, number ] = [ iw * ow, ih * oh ]
    return { rect_inner, rect_outer, fractions, aspect_inner, aspect_outer: aspect ?? aspect_outer }
}

interface BoxArgs extends GroupArgs {
    padding?: Padding
    margin?: Padding
    border?: boolean | number
    fill?: string
    shape?: Element
    rounded?: Rounded
    adjust?: boolean
}

// a box around its content: padding inside the border and margin outside,
// both as fractions of the box (adjusted to its aspect, so they look the same
// on every side). the content is the children with no rect of their own,
// which fill the padded area; a child at a rect of its own is placed by it as
// in any group. offered a size (by the Svg, a stack or another box), the box
// lays its content out for the area and takes the shape of what comes back:
// a column in a frame keeps its text size and hugs its height, a figure
// gives the box its aspect, a stretch fills it. a box with an `aspect` of its
// own fits the offer at it instead, and a `flex` one fills the offer
class Box extends Group {
    em?: EmSpec
    content: Element[]
    fractions: [ number, number ]

    constructor(args: BoxArgs = {}) {
        const { children: children0, padding, margin, border, fill, shape: shape0, rounded, aspect: aspect0, flex, clip, adjust = true, debug = false, offer, env, ...attr0 } = THEME(args, 'Box')
        const [ border_attr, fill_attr, attr] = prefix_split([ 'border', 'fill' ], attr0)
        const children = ensure_children(children0)
        const aspect = aspect0 as number | undefined
        const content = children.filter(c => c.spec.rect == null)

        // ensure shape is a function
        const shape = shape0 ?? maybe_rounded_rect(rounded, env)

        // the rects for a content aspect: the box's own comes first
        const rects = (aspect_child?: number) => computeBoxLayout(children, { padding, margin, aspect, adjust, aspect_child })
        let L = rects()
        let placed = children
        let em: EmSpec | undefined

        // laid out for an offer (see place): a box with a shape of its own is
        // the size offered, and its content is laid out for the padded area
        // (to be fit into it, so text that does not fit scales). else the
        // first content child is laid out for the area of the offer and the
        // box hugs what it came to, with the padding found again for that
        // shape (and the child laid out again if that moved the area); the
        // rest of the content is laid out for the area of the box
        if (offer != null && content.length > 0) {
            const fixed = aspect != null || flex
            const slot = (w?: number, h?: number): Offer => ({ width: w != null ? w * L.fractions[0] : undefined, height: h != null ? h * L.fractions[1] : undefined, fit: fixed || undefined })
            let first = content[0].lay(slot(offer.width, offer.height))
            let [ width, height ] = [ offer.width ?? offer.height!, offer.height ?? offer.width! ]
            if (!fixed) {
                if (adjust && first.em.width > 0 && first.em.height > 0) {
                    const L1 = rects(first.em.width / first.em.height)
                    if (Math.abs(L1.fractions[0] - L.fractions[0]) > 1e-9 || Math.abs(L1.fractions[1] - L.fractions[1]) > 1e-9) {
                        L = L1
                        first = content[0].lay(slot(offer.width, offer.height))
                    }
                }
                [ width, height ] = [ first.em.width / L.fractions[0], first.em.height / L.fractions[1] ]
            }
            const laid = [ first, ...content.slice(1).map(c => c.lay(slot(width, height))) ]

            // the laid content in place of the children, and the box with the
            // first content's anchor (it sits in the middle of the area)
            placed = children.map(c => { const i = content.indexOf(c); return i >= 0 ? laid[i].elem : c })
            const top = L.rect_outer[1] + L.rect_inner[1] * (L.rect_outer[3] - L.rect_outer[1])
            em = make_em({ width, height, anchor: top * height + 0.5 * (L.fractions[1] * height - first.em.height) + first.em.anchor })
        }

        // make framing elements
        const rect_cl = (clip === true) ? shape : clip
        const rect_bg = fill != null ? shape.clone({ fill, stroke: none, ...fill_attr }) : null
        const rect_fg = border != null ? shape.clone({ stroke_width: border, ...border_attr }) : null

        // make inner groups
        const inner = new Group({ children: placed, rect: L.rect_inner, debug, env })
        const outer = new Group({ children: [ rect_bg, inner, rect_fg ], rect: L.rect_outer, clip: rect_cl, env })

        // pass to Group
        super({ children: [ outer ], aspect: em != null ? box_aspect(em.width, em.height) : L.aspect_outer, upright: true, env, ...attr })
        this.args = args
        this.em = em
        this.content = content
        this.fractions = L.fractions
    }

    // the first content child's bounds over its fraction of the box; a box
    // with a shape of its own is any element of its aspect
    natural(): Bounds {
        const { aspect, flex } = this.args
        if (aspect != null || flex === true || this.content.length == 0) return super.natural()
        const [ fx, fy ] = this.fractions
        return scale_bounds(this.content[0].bounds(), 1 / fx, 1 / fy)
    }

    // laid out again for the offer: a box with a shape of its own is sized
    // as any element of its aspect and rebuilt at that size, one without
    // takes the shape of its content laid out for the offer. nothing
    // offered, no content, or a rotation (a figure): as any element
    place(offer: Offer = {}): Laid {
        const { aspect, flex, rotate } = this.args
        if ((offer.width == null && offer.height == null) || this.content.length == 0 || rotate) return super.place(offer)
        const size = (aspect != null || flex === true) ? super.place(offer).em : offer
        const elem = this.clone({ offer: { width: size.width, height: size.height } }) as Box
        return { elem, em: elem.em! }
    }
}

class Frame extends Box {
    constructor(args: BoxArgs = {}) {
        const { border = 1, ...attr } = THEME(args, 'Frame')
        super({ border, ...attr })
        this.args = args
    }
}

//
// stack
//

interface StackArgs extends GroupArgs, EmArgs {
    direc?: Orient
    gap?: number                 // between children, in em
    spacing?: boolean | number   // between children, as a fraction of the stack's length
    justify?: AlignValue         // across a column (and along a row narrower than its width); also the text alignment handed down
    valign?: RowAlign            // across a row: top, anchor, center, bottom
    anchor?: 'first' | 'center'  // where the stack's anchor is
    even?: boolean               // every child an equal share
    width?: number               // the stack's size in em: what a column offers, a row divides
    height?: number
    font_family?: string
    font_weight?: number
    font_style?: string
}

// one stack for figures, text and math, vertical or horizontal, laid out in
// em by the engine (see lib/layout.ts and layout_em_stack): every child is
// laid for its slot by what it is. a figure (an aspect) spans a column's
// width or takes a row's height, text wraps to its slot, a formula keeps its
// size, a bare element fills what is left; a child with a `width` or `height`
// of its own keeps it, one with a `share` gets that fraction of the stack's
// length. `gap` is in em, `spacing` a fraction of the length (the share
// world's unit, so a stack of figures stays scale-free). the stack reports
// its box in em like any measured element, so stacks nest; a child's `scale`
// sets its size relative to the stack's em, and its own `align` places it in
// its slot in place of the stack's justify or valign. font and text settings
// (`font-*`, `text-*`) are handed to the text children
class Stack extends Group {
    em: EmSpec
    items: Element[]
    direc: Orient
    options: EmStackOptions

    constructor(args: StackArgs = {}) {
        const { children: children0, direc = 'v', gap = 0, spacing: spacing0 = 0, justify = 'center', valign = 'center', anchor = 'first', even = false, width, height, scale = 1, offer, env, ...attr0 } = THEME(args, 'Stack')
        const [ font_attr0, text_attr, attr1 ] = prefix_split([ 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const [ spec, attr ] = spec_split(attr1)
        const children = ensure_children(children0)
        const spacing = spacing0 === true ? 0.1 : spacing0 === false ? 0 : spacing0

        // an even stack gives every child the same share of what the spacing leaves
        const n = children.length
        const items = even ? children.map(c => c.share != null ? c : c.clone({ share: (1 - spacing * Math.max(n - 1, 0)) / n })) : children

        // the size laid out for: its own, or the offer (in the stack's em);
        // with neither (a stack placed by rect in a group, which has no em to
        // offer) it hugs its children at their natural sizes and is fit to
        // its rect, as in the share world
        const W = width ?? (offer?.width != null ? offer.width / scale : undefined)
        const H = height ?? (offer?.height != null ? offer.height / scale : undefined)
        // a stack with no width of its own hugs its children across the axis:
        // the width offered is what they may take, not what the stack is
        const options: EmStackOptions = { gap, spacing, justify, valign, anchor, hug: width == null, attr: { ...font_attr, ...text_attr } }
        const { metrics, ...layout } = layout_em_stack(direc, items, { ...options, width: W, height: H })

        // pass to Group
        super({ env, ...layout, upright: true, ...attr, ...spec, width, height })
        this.args = args
        this.items = items
        this.direc = direc
        this.options = options
        this.em = make_em(scale_em_spec(make_em(metrics), scale))
    }

    // composed from the children's bounds, in the parent's em
    natural(): Bounds {
        return scale_bounds(layout_em_bounds(this.direc, this.items, this.options), this.scale)
    }

    // laid out again for the offer, with the text alignment and settings
    // handed down to a stack that has none of its own
    place(offer: Offer = {}): Laid {
        const { width, height, fill, justify, attr = {} } = offer
        const justify_attr = justify != null && this.args.justify == null ? { justify } : {}
        const size = (fill && width != null && this.args.width == null) ? { width: width / this.scale, offer: { height } } : { offer: { width, height } }
        const elem = this.clone({ ...attr, ...justify_attr, ...size }) as Stack
        return { elem, em: elem.em }
    }
}

class VStack extends Stack {
    constructor(args: StackArgs = {}) {
        const attr = THEME(args, 'VStack')
        super({ direc: 'v', ...attr })
        this.args = args
    }
}

class HStack extends Stack {
    constructor(args: StackArgs = {}) {
        const attr = THEME(args, 'HStack')
        super({ direc: 'h', ...attr })
        this.args = args
    }
}

interface HWrapArgs extends StackArgs {
    hgap?: number   // between items in a row, in em
    vgap?: number   // between rows, in em
}

// items wrapped into rows of a `width` in em: each item at its natural size
// for a one em row, as many to a row as fit, the rows stacked
class HWrap extends Stack {
    constructor(args: HWrapArgs = {}) {
        const { children: children0, width, hgap = 0, vgap = 0, justify = 'left', env, ...attr } = THEME(args, 'HWrap')
        const children = ensure_children(children0)

        // wrap by the widths the items come out at one em tall
        const measure = (c: Element) => c.lay({ height: 1 }).em.width + hgap
        const { rows } = wrapWidths(children, measure, width != null ? width + hgap : undefined)
        const lines = rows.map(row => new Stack({ direc: 'h', children: row, gap: hgap, justify, valign: 'top', env }))

        // pass to Stack
        super({ direc: 'v', children: lines, gap: vgap, justify, width, env, ...attr })
        this.args = args
    }
}

/* grid layout and aspect computation (grok)
\log(\mu) = \frac{1}{M N} \sum_{i=1}^M \sum_{j=1}^N \log a_{ij}
\log(u)_j = \frac{1}{M} \sum_{i=1}^M \log a_{ij} - \log(\mu)
\log(v)_i = \log(\mu) - \frac{1}{N} \sum_{j=1}^N \log a_{ij}
w_j = \frac{u_j}{\sum_{k=1}^N u_k}
h_i = \frac{v_i}{\sum_{k=1}^M v_k}
\log(a) = \log(\mu) - \frac{1}{N} \sum_{j=1}^N \log(w_j) + \frac{1}{M} \sum_{i=1}^M \log(h_i)
*/

function computeGridLayout(children: Element[][], rows: number, cols: number, { widths: widths0, heights: heights0, spacing = 0 }: { widths?: number[], heights?: number[], spacing?: number | [number, number] } = {}): { cranges: Limit[], rranges: Limit[], aspect: number } {
    // aggregate aspect ratios along rows and columns (assuming null goes to 1)
    const aspect_grid = children.map(row => row.map(e => e.spec.aspect ?? 1))
    const log_aspect = aspect_grid.map(row => row.map(log))

    // these are exact for equipartitioned grids (row or column)
    const log_mu = mean(log_aspect.map(row => mean(row)))
    const log_uj = zip(...log_aspect).map(mean).map(x => x - log_mu)
    const log_vi = log_aspect.map(mean).map(x => log_mu - x)

    // implement findings
    let widths = widths0 ?? normalize(log_uj.map(exp))
    let heights = heights0 ?? normalize(log_vi.map(exp))
    const aspect_ideal = exp(log_mu - mean(widths.map(log)) + mean(heights.map(log)))

    // adjust widths and heights to account for spacing
    const [spacex, spacey] = ensure_pair(spacing)
    const [scalex, scaley] = [1 - spacex * (cols-1), 1 - spacey * (rows-1)]
    widths = widths.map(w => scalex * w)
    heights = heights.map(h => scaley * h)
    const aspect = (1-spacey*(rows-1))/(1-spacex*(cols-1)) * aspect_ideal

    // get top left positions
    const lposit = cumsum(widths.map(w => w + spacex))
    const tposit = cumsum(heights.map(h => h + spacey))
    const cranges = zip(lposit, widths).map(([l, w]) => [l, l + w] as Limit)
    const rranges = zip(tposit, heights).map(([t, h]) => [t, t + h] as Limit)

    return { cranges, rranges, aspect }
}

function computeGridSize(num: number, rows: number | undefined, cols: number | undefined): { rows: number, cols: number } {
    if (rows == null && cols != null) {
        rows = Math.ceil(num / cols)
    } else if (cols == null && rows != null) {
        cols = Math.ceil(num / rows)
    } else if (rows == null && cols == null) {
        throw new Error('Either rows or cols must be specified')
    } else {}
    return { rows: rows as number, cols: cols as number }
}

interface GridArgs extends GroupArgs {
    rows?: number
    cols?: number
    widths?: number[]
    heights?: number[]
    spacing?: number | Point
}

class Grid extends Group {
    constructor(args: GridArgs = {}) {
        const { children: children0, rows: rows0, cols: cols0, widths, heights, spacing, aspect: aspect0, env, ...attr } = THEME(args, 'Grid')
        const children = ensure_children(children0)

        // reshape children to grid
        const { rows, cols } = computeGridSize(children.length, rows0, cols0)
        let grid = reshape(children, [rows, cols])

        // fill in missing rows and columns
        const spacer = new Spacer({ env })
        const filler = repeat(spacer, cols)
        grid = grid.map(row => padvec(row, cols, spacer))
        grid = padvec(grid, rows, filler)

        // compute layout
        const { cranges, rranges, aspect: aspect_ideal } = computeGridLayout(grid, rows, cols, { widths, heights, spacing })
        const aspect = aspect0 ?? aspect_ideal

        // make grid
        const mesh = meshgrid(rranges, cranges)
        const items = zip(children, mesh).map(([ child, [ ylim, xlim ] ]) =>
            child.clone({ xrect: xlim, yrect: ylim })
        )

        // pass to Group
        super({ children: items, aspect, upright: true, env, ...attr })
        this.args = args
    }
}

//
// placement classes
//

interface PointsArgs extends GroupArgs {
    points?: Point[]
    point_size?: number | Point
    point_shape?: Element
}

// places a bunch of clones at points
class Points extends Group {
    points: Point[]

    constructor(args: PointsArgs = {}) {
        const { points: points0, point_size = D.point, point_shape: point_shape0, env, ...attr0 } = THEME(args, 'Points')
        const [ spec, attr ] = spec_split(attr0)
        const points = check_array(points0)
        const shape = point_shape0 ?? new Dot({ env, ...attr })
        const children = points.map((pos: Point) => shape.clone({ pos, size: point_size })) ?? []
        super({ children, env, ...spec })
        this.args = args
        this.points = points
    }

    graphCoord(): Rect | undefined {
        return super.graphCoord() ?? merge_points(this.points)
    }
}

interface AnchorArgs extends GroupArgs {
    direc?: Orient
    justify?: AlignValue
    loc?: AlignValue
}

// circumscribe a parent element with a child element (loc and justify specify where its anchored to)
// doing this in an aspect-ed element allows you to pivot sizes across dimensions (see tick labels)
class Anchor extends Group {
    constructor(args: AnchorArgs = {}) {
        const { children: children0, direc = 'h', justify = 'center', loc: loc0 = 0.5, ...attr } = args
        const child0 = check_singleton(children0)

        // assign spec to child
        const frac = align_frac(loc0 ?? justify)
        const child = child0.clone({
            rect: join_limits({ [direc]: [ frac, frac ] }),
            align: justify,
            expand: true,
        })

        // pass to Group
        super({ children: [ child ], ...attr })
        this.args = args
    }
}

function attach_rect(side: Side, loc: number, offset: number, extent: number): Rect {
    const far = extent + offset
    if (side == 't') return [ loc       , -far      , loc       , -offset    ]
    if (side == 'b') return [ loc       , 1 + offset, loc       , 1 + far    ]
    if (side == 'l') return [ -far      , loc       , -offset   , loc        ]
    if (side == 'r') return [ 1 + offset, loc       , 1 + far   , loc        ]
    throw new Error(`Unrecognized side: ${side}`)
}

interface AttachArgs extends GroupArgs {
    offset?: number
    extent?: number
    side?: Side
}

// attach a child element to the edge of a parent element
class Attach extends Group {
    constructor(args: AttachArgs = {}) {
        const { children: children0, side: side0 = 'top', extent = 1, offset = 0, loc = 0.5, justify = 'center', ...attr } = THEME(args, 'Attach')
        const child0 = check_singleton(children0)
        const side = norm_side(side0)

        // get extent and map to child
        const rect = attach_rect(side, loc, offset, extent)
        const child = child0.clone({ rect, expand: true, align: justify })

        // pass to Group
        super({ children: [ child ], ...attr })
        this.args = args
    }
}

interface AbsoluteArgs extends ElementArgs {
    children?: (Element | null)[]
    size?: number | Point
}

class Absolute extends Element {
    child: Element
    size?: number | Point

    constructor(args: AbsoluteArgs = {}) {
        const { children: children0, size, ...attr } = THEME(args, 'Absolute')
        const child = check_singleton(children0)

        // pass to Element
        super({ tag: 'g', unary: false, ...attr })
        this.args = args

        // additional props
        this.child = child
        this.size = size
    }

    inner(ctx: Context): string {
        const { prect } = ctx

        // get relative size from absolute size
        const pcent = rect_center(prect)
        const pradi = rect_radius(prect)
        const psize = ensure_vector(this.size, 2) as Point
        const rect = radial_rect(pcent, div2(psize, pradi))

        // render child element
        const ctx1 = ctx.map({ ...this.child.spec, rect })
        return this.child.svg(ctx1)
    }
}

//
// exports
//

export { computeBoxLayout, Box, Frame, Stack, VStack, HStack, HWrap, Grid, Points, Anchor, Attach, Absolute }
export type { BoxArgs, StackArgs, HWrapArgs, GridArgs, PointsArgs, AnchorArgs, AttachArgs, AbsoluteArgs }
