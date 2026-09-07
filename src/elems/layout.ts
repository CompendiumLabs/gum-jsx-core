// layout components

import { THEME } from '../lib/theme'
import type { Env } from '../env'
import { DEFAULTS as D, none } from '../lib/const'
import { is_scalar, ensure_vector, ensure_pair, log, exp, max, sum, zip, div2, cumsum, reshape, repeat, meshgrid, padvec, normalize, mean, identity, invert, aspect_invariant, check_singleton, check_array, rect_center, rect_radius, join_limits, radial_rect, norm_side, intersperse, prefix_split, merge_points, pad_rect } from '../lib/utils'
import { wrapWidths } from '../lib/wrap'

import { Context, Group, Element, Rectangle, Spacer, spec_split, align_frac, ensure_children, is_element } from './core'
import { RoundedRect, Dot } from './geometry'
import { layout_stack, layout_element, frame_layout } from './sizing'
import { make_em, em_rect, em_aspect, hull_overhang, scale_em_spec } from '../lib/em'
import type { EmSpec } from '../lib/em'
import type { LayoutOffer, LayoutResult, RowAlign, Overflow } from '../lib/layout'

import type { Point, Rect, Limit, AlignValue, Side, Orient, Padding, Rounded } from '../lib/types'
import type { ElementArgs, GroupArgs } from './core'

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

function computeBoxLayout(children: Element[], { padding, margin, aspect, adjust = true }: { padding?: Padding, margin?: Padding, aspect?: number, adjust?: boolean } = {}) {
    // try to determine box aspect
    const aspect_child = aspect ?? children[0]?.spec?.aspect

    // handle all null case
    if (padding == null && margin == null) {
        return {
            rect_inner: D.rect, rect_outer: D.rect,
            aspect_inner: aspect_child, aspect_outer: aspect_child
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

    // return inner/outer rects and aspect
    return { rect_inner, rect_outer, aspect_inner, aspect_outer: aspect ?? aspect_outer }
}

interface BoxArgs extends GroupArgs {
    padding?: Padding
    margin?: Padding
    border?: boolean | number
    fill?: string
    shape?: Element
    rounded?: Rounded
    adjust?: boolean
    scale?: number
    max_width?: number
    max_height?: number
    hug?: boolean
    stretch?: boolean
    fit?: boolean
    justify?: AlignValue
    valign?: AlignValue
}

class Box extends Group {
    em?: EmSpec
    private readonly stretch: boolean
    get reflow(): boolean { return this.em != null }

    constructor(args: BoxArgs = {}) {
        const {
            children: children0, width, height, max_width, max_height, scale = 1,
            hug = true, stretch = !hug, fit = false, justify = 'center', valign = 'center',
            padding, margin, border, fill, shape: shape0, rounded, aspect: aspect0,
            clip, adjust = true, debug = false, env, ...attr0
        } = THEME(args, 'Box')
        const [ border_attr, fill_attr, font_attr, text_attr, attr ] = prefix_split([ 'border', 'fill', 'font', 'text' ], attr0)
        const font = Object.fromEntries(Object.entries(font_attr).map(([k, v]) => ['font_' + k, v]))
        const typography = { ...font, ...text_attr, justify }
        const children = ensure_children(children0)
        if (children.some(c => !is_element(c))) {
            throw new TypeError('Box/Frame children must be elements. Wrap text in Text, or use TextBox/TextFrame.')
        }
        const aspect = typeof aspect0 == 'number' && aspect0 > 0 ? aspect0 : (aspect0 as any) === true ? 1 : undefined
        const only = children.length == 1 ? children[0] : undefined
        const natural = only?.sizing
        const bounded = width != null || height != null || max_width != null || max_height != null
        const measured = !fit && args.coord == null && (bounded || (only?.spec.rect == null && (natural?.width != null || natural?.height != null)))

        // Background, border, and clipping use the same shape.
        const shape = shape0 ?? maybe_rounded_rect(rounded, env)

        if (measured) {
            // Measured frames use layout units for their insets. The child
            // resolves wrapping inside those insets; extra room belongs to
            // the frame and never changes the child's em.
            const [ pl, pt, pr, pb ] = pad_rect(padding)
            const [ ml, mt, mr, mb ] = pad_rect(margin)
            const dx = pl + pr + ml + mr, dy = pt + pb + mt + mb
            let w = width ?? (height != null && aspect != null ? height * aspect : undefined)
            let h = height ?? (width != null && aspect != null ? width / aspect : undefined)
            if (w != null && h != null && aspect != null) {
                w = Math.min(w, h * aspect)
                h = w / aspect
            }
            const child = only ?? new Group({ children, aspect: 'auto', env })
            const available = w ?? max_width
            const innerWidth = available != null ? Math.max(0, available - dx) : undefined
            const laid = child.layout({
                maxWidth: innerWidth != null && (!stretch || w == null) ? Math.min(innerWidth, natural?.width ?? Infinity) : innerWidth,
                maxHeight: (h ?? max_height) != null ? Math.max(0, (h ?? max_height)! - dy) : undefined,
                attrs: { ...typography, justify: child.args.justify ?? justify },
            })
            const em = laid.em
            w ??= em.width + dx
            h ??= em.height + dy
            if (aspect != null && width == null && height == null) {
                w = Math.max(w, h * aspect)
                h = w / aspect
            }
            const [ ax, ay ] = ensure_pair(child.spec.align ?? [justify, valign])
            const x = ml + pl + align_frac(ax) * (w - dx - em.width)
            const y = mt + pt + align_frac(ay) * (h - dy - em.height)
            const rect = em_rect(em, x, y + em.anchor)
            // An unconstrained frame hugs the ink as well as the layout box.
            // A declared dimension keeps its border fixed when ink overflows.
            const frameRect: Rect = [
                width != null ? ml : Math.min(ml, rect[0] - pl),
                height != null ? mt : Math.min(mt, rect[1] - pt),
                width != null ? w - mr : Math.max(w - mr, rect[2] + pr),
                height != null ? h - mb : Math.max(h - mb, rect[3] + pb),
            ]
            const bounds: Rect = [frameRect[0] - ml, frameRect[1] - mt, frameRect[2] + mr, frameRect[3] + mb]
            const { hink, vink, coord } = hull_overhang(clip ? [bounds] : [bounds, rect], w, [0, h])
            const metrics = make_em({ width: w, height: h, anchor: y + em.anchor, scale: em.scale, hink, vink })
            // A zero-sized drawing has no coordinate map. Keep its allocation
            // and anchor, but do not send a degenerate frame to the renderer.
            if (coord[0] == coord[2] || coord[1] == coord[3]) {
                super({ children: [], upright: true, env, ...attr })
                this.args = args
                this.stretch = stretch
                this.em = make_em(scale_em_spec(metrics, scale))
                return
            }
            const background = fill != null ? shape.clone({ rect: frameRect, fill, stroke: none, ...fill_attr }) : null
            const foreground = border != null && border !== false ? shape.clone({ rect: frameRect, stroke_width: border, ...border_attr }) : null
            const content = new Group({ children: [laid.elem.clone({ rect })], coord, debug, env })
            const clipping = clip ? new Group({ children: [clip === true ? shape : clip], rect: frameRect, env }) : undefined
            const body = new Group({ children: [background, content, foreground], coord, clip: clipping, aspect: em_aspect(metrics), env })
            const framed = frame_layout({ elem: body, em: metrics }, width ?? w, height ?? h)
            super({ children: [framed.elem], coord: em_rect(framed.em, 0, framed.em.anchor), aspect: em_aspect(framed.em), upright: true, env, ...attr })
            this.args = args
            this.stretch = stretch
            this.em = make_em(scale_em_spec(framed.em, scale))
            return
        }

        // compute layout
        const frameAspect = aspect ?? (width != null && height != null && height > 0 ? width / height : undefined)
        const { rect_inner, rect_outer, aspect_outer } = computeBoxLayout(children, { padding, margin, aspect: frameAspect as number | undefined, adjust })

        // make framing elements
        const rect_cl = (clip === true) ? shape : clip
        const rect_bg = fill != null ? shape.clone({ fill, stroke: none, ...fill_attr }) : null
        const rect_fg = border != null ? shape.clone({ stroke_width: border, ...border_attr }) : null

        // make inner groups
        const inner = new Group({ children, rect: rect_inner, debug, env })
        const outer = new Group({ children: [ rect_bg, inner, rect_fg ], rect: rect_outer, clip: rect_cl, env })

        // pass to Group
        super({ children: [ outer ], width, height, aspect: aspect_outer, upright: true, env, ...font, ...attr })
        this.args = args
        this.stretch = stretch
    }

    layout(offer: LayoutOffer = {}): LayoutResult {
        if (!this.reflow) return layout_element(this, offer)
        const scale = this.args.scale ?? 1
        const patch = { ...offer.attrs } as Record<string, any>
        if (this.args.width == null && offer.width != null && this.stretch) patch.width = offer.width / scale
        if (this.args.height == null && offer.height != null && this.stretch) patch.height = offer.height / scale
        if (offer.maxWidth != null || (!this.stretch && offer.width != null)) patch.max_width = (offer.width ?? offer.maxWidth)! / scale
        if (offer.maxHeight != null || (!this.stretch && offer.height != null)) patch.max_height = (offer.height ?? offer.maxHeight)! / scale
        const changed = Object.keys(patch).some(k => patch[k] !== this.args[k])
        return layout_element(changed ? this.clone(patch) : this, offer)
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
// stack/wrap/grid classes
//

interface StackArgs extends GroupArgs {
    direc?: Orient
    spacing?: boolean | number  // fraction of the main axis reserved for gaps
    gap?: number               // gap in layout units
    scale?: number
    max_width?: number
    max_height?: number
    justify?: AlignValue
    valign?: RowAlign
    even?: boolean  // divide the unreserved space into equal fractional shares
    sizes?: number[]
    overflow?: Overflow
}

// Geometry, paragraphs, and formulas use the same allocator. A purely
// geometric stack carries only an aspect until an ancestor gives it a size.
class Stack extends Group {
    em?: EmSpec
    get reflow(): boolean { return true }

    constructor(args: StackArgs = {}) {
        const {
            children: children0, direc = 'v', width, height, max_width, max_height,
            spacing = 0, gap, scale = 1, justify = 'center', valign = 'center',
            aspect: aspect0, even = false, sizes, overflow = 'visible', env, ...attr0
        } = THEME(args, 'Stack')
        const children = ensure_children(children0)
        const [ font_attr, text_attr, attr1 ] = prefix_split(['font', 'text'], attr0)
        const attrs = { ...Object.fromEntries(Object.entries(font_attr).map(([k, v]) => ['font_' + k, v])), ...text_attr }
        const [ spec, attr ] = spec_split(attr1)
        const ratio = typeof aspect0 == 'number' && aspect0 > 0 ? aspect0 : undefined
        const contentWidth = ratio != null ? (width != null && height != null ? Math.min(width, height * ratio) : width ?? (height != null ? height * ratio : undefined)) : width
        const contentHeight = ratio != null && contentWidth != null ? contentWidth / ratio : height
        let laid = layout_stack(children, {
            direc, width: contentWidth, height: contentHeight, maxWidth: max_width, maxHeight: max_height,
            spacing: spacing as number, gap, justify, valign, even, sizes, overflow, attrs,
        })
        const outerWidth = width ?? (ratio != null ? Math.max(laid.metrics.width, laid.metrics.height * ratio) : laid.metrics.width)
        const outerHeight = height ?? (ratio != null ? outerWidth / ratio : laid.metrics.height)
        if (outerWidth != laid.metrics.width || outerHeight != laid.metrics.height) {
            const body = new Group({ children: laid.children, coord: laid.coord, aspect: laid.aspect, env })
            const framed = frame_layout({ elem: body, em: laid.metrics }, outerWidth, outerHeight)
            laid = { ...laid, children: [framed.elem], coord: [0, 0, outerWidth, outerHeight], aspect: outerWidth / outerHeight, metrics: framed.em }
        }
        super({ children: laid.children, coord: laid.coord, aspect: laid.aspect, upright: true, env, ...attr, ...spec })
        this.args = args
        if (laid.measured) this.em = make_em(scale_em_spec(laid.metrics, scale))
    }

    layout(offer: LayoutOffer = {}): LayoutResult {
        const scale = this.args.scale ?? 1
        const patch = { ...offer.attrs } as Record<string, any>
        if (this.args.width == null && offer.width != null) patch.width = offer.width / scale
        if (this.args.height == null && offer.height != null) patch.height = offer.height / scale
        if (offer.maxWidth != null) patch.max_width = offer.maxWidth / scale
        if (offer.maxHeight != null) patch.max_height = offer.maxHeight / scale
        const changed = Object.keys(patch).some(k => patch[k] !== this.args[k])
        return layout_element(changed ? this.clone(patch) : this, offer)
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

function default_measure(c: Element): number {
    return c.spec.aspect ?? 1
}

interface HWrapArgs extends StackArgs {
    padding?: number
    width?: number  // the row width to wrap at, in units of the row height
    measure?: (c: Element) => number
}

// like stack but wraps elements to multiple lines/columns
class HWrap extends VStack {
    constructor(args: HWrapArgs = {}) {
        const { children: children0, hspacing, vspacing, width, justify = 'left', measure: measure0, debug, env, ...attr } = THEME(args, 'HWrap')
        const children = ensure_children(children0)
        const measure = measure0 ?? default_measure

        // intersperse spacers if needed and wrap widths
        const items = hspacing > 0 ? intersperse(children, new Spacer({ aspect: hspacing, env })) : children
        const { rows } = wrapWidths(items, measure, width)

        // make HStack rows
        const lines = rows.map(row => new HStack({ children: row, align: justify, aspect: width, debug, env }))

        // pass to VStack
        super({ children: lines, spacing: vspacing, even: true, debug, env, ...attr })
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
