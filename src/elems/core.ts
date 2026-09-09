// core components

import { THEME } from '../lib/theme'
import { DEFAULTS as D, svgns, sans, light, blue, red, d2r } from '../lib/const'
import { is_scalar, abs, cos, sin, tan, cot, mul2, div2, filter_object, expand_rect, rect_box, cbox_rect, rect_cbox, merge_points, merge_rects, join_limits, ensure_pair, rounder, heavisign, abs_min, abs_max, rect_radial, rotate_aspect, remap_rect, rescaler, resizer, rect_size, vector_angle, polard, upright_rect } from '../lib/utils'
import { resolveEnv } from '../lib/default'
import { make_em, scale_em_spec, em_rect, em_frame } from '../lib/em'
import type { EmSpec } from '../lib/em'
import { INF, EPS, FREE_BOUNDS, point, tie_width, tie_height } from '../lib/layout'
import type { Bounds, Offer, Laid as LaidItem } from '../lib/layout'
import type { WithEm } from './em'
import type { Env } from '../env'

import type { Point, Rect, Size, AlignValue, Align, Side, Attrs, MNumber, MPoint, Spec, Limit } from '../lib/types'

//
// rect embedding
//

function align_frac(align: AlignValue): number {
    if (is_scalar(align)) {
        return align as number
    } else if (align == 'left' || align == 'top') {
        return 0
    } else if (align == 'center' || align == 'middle') {
        return 0.5
    } else if (align == 'right' || align == 'bottom') {
        return 1
    } else{
        throw new Error(`Unrecognized alignment specification: ${align}`)
    }
}

function anchor_point(rect: Rect, side: Side, loc: number): Point {
    const [ xmin, ymin, xmax, ymax] = rect
    const [ xmid, ymid ] = [ xmin + (xmax - xmin) * loc, ymin + (ymax - ymin) * loc ]
    if (side == 'top' || side == 't') return [ xmid, ymin ]
    if (side == 'bottom' || side == 'b') return [ xmid, ymax ]
    if (side == 'right' || side == 'r') return [ xmax, ymid ]
    if (side == 'left' || side == 'l') return [ xmin, ymid ]
    if (side == 'north' || side == 'n') return [ xmid, ymin ]
    if (side == 'south' || side == 's') return [ xmid, ymax ]
    if (side == 'east' || side == 'e') return [ xmax, ymid ]
    if (side == 'west' || side == 'w') return [ xmin, ymid ]
    throw new Error(`Unrecognized side: ${side}`)
}

// embed a rect of given `aspect` into rect of given `size`
function embed_size(size: Point, { aspect, expand = false }: { aspect?: number, expand?: boolean } = {}): Size {
    if (aspect == null || aspect == 0) return size
    const [ w0, h0 ] = size
    const [ aw, ah ] = [ abs(w0), abs(h0) ]
    const [ sw, sh ] = [ heavisign(w0), heavisign(h0) ]
    const agg = expand ? Math.max : Math.min
    const h = agg(aw / aspect, ah)
    const w = h * aspect
    return [ sw * w, sh * h ]
}

// get the size of an `aspect` rect that will fit in `size` after `rotate`
function rotate_rect(size: Size, rotate: number, { aspect, expand = false, rotate_invar = false, tol = 0.001 }: { aspect?: number, expand?: boolean, rotate_invar?: boolean, tol?: number } = {}): Size {
    // knock out easy case
    if (rotate == 0 || rotate_invar) return embed_size(size, { aspect, expand })

    // unpack inputs
    const [ w0, h0 ] = size
    const [ aw0, ah0 ] = [ abs(w0), abs(h0) ]
    const [ sw, sh ] = [ heavisign(w0), heavisign(h0) ]
    const theta = d2r * rotate

    // trig compute
    const COS = abs(cos(theta))
    const SIN = abs(sin(theta))

    // Fit using absolute extents, then restore signs so flipped coordinate
    // systems preserve their orientation on each axis independently.
    let [ w, h ] = [ aw0, ah0 ]
    if (aspect != null) {
        // this has an exact solution
        const DW = aspect * COS + SIN
        const DH = aspect * SIN + COS
        const agg = expand ? abs_max : abs_min
        h = agg(aw0 / DW, ah0 / DH)
        w = h * aspect
    } else {
        // this has some degeneracy, which we resolve with maximal area
        // max Area = w * h
        // st  C * w + S * h <= w0
        //     C * h + S * w <= h0
        const paspect = aw0 / ah0
        const TAN = abs(tan(theta))
        const COT = abs(cot(theta))
        const [ TL, TH ] = [ Math.min(TAN, COT), Math.max(TAN, COT) ]
        if (paspect < TL) {
            w = aw0 / (2 * COS)
            h = aw0 / (2 * SIN)
        } else if (paspect > TH) {
            w = ah0 / (2 * SIN)
            h = ah0 / (2 * COS)
        } else {
            const denom = COS * COS - SIN * SIN
            if (abs(denom) < tol) {
                // this uses a leontieff objective
                const t = abs_min(aw0, ah0) / (COS + SIN)
                w = h = t
            } else {
                w = (aw0 * COS - ah0 * SIN) / denom
                h = (ah0 * COS - aw0 * SIN) / denom
            }
        }
    }

    // return base and rotated rect sizes
    return [ sw * w, sh * h ]
}

function rotate_repr(rotate: number, pos: Point, prec: number = D.prec): string {
    const [ x, y ] = pos
    return `rotate(${rounder(rotate, prec)}, ${rounder(x, prec)}, ${rounder(y, prec)})`
}

function adjust_rotate(rotate: number, psize: Size, coord: Rect): number {
    if (rotate == 0) return rotate
    const csize = rect_size(coord)
    const proj = div2(psize, csize)
    const vec = polard(rotate, proj)
    return vector_angle(vec)
}

//
// context class
//

interface ContextArgs {
    prect?: Rect
    prec?: number
    coord?: Rect
    transform?: string
    meta?: Metadata
    unit?: number
}

interface MapArgs {
    offset?: boolean
}

// context holds the current pixel rect and other global settings
// map() will create a new sub-context using rect in coord space
// map*() functions map from coord to pixel space (in prect)
class Context {
    args: ContextArgs
    prect: Rect
    coord: Rect
    prec: number
    meta: Metadata
    unit: number
    transform: string | undefined
    rescalex: (v: number | MNumber, offset?: boolean) => number
    rescaley: (v: number | MNumber, offset?: boolean) => number
    resizex: (v: number | MNumber, offset?: boolean) => number
    resizey: (v: number | MNumber, offset?: boolean) => number

    constructor(args: ContextArgs = {}) {
        const { prect = D.rect, coord = D.coord, transform, prec = D.prec, meta, unit = 1 } = args
        this.args = args

        // coordinate transform
        this.prect = prect // drawing rect
        this.coord = coord // coordinate rect
        this.transform = transform // rotation transform

        // top level arguments
        this.prec = prec // string precision

        // percolated upwards
        this.meta = meta ?? new Metadata() // meta data

        // stroke unit: pixels per unit of stroke_width (and of the offset part
        // of an MNumber). Set at the root from the image size and inherited by
        // every child, so strokes scale with the image rather than staying a
        // fixed pixel width; a container may rebase it to its own box (math
        // sets it to pixels per em) so that its strokes scale with its content
        this.unit = unit

        // make rescaler / resizer
        // there are heavily used, so precompute what we can (haven't profiled yet)
        const [ cx1, cy1, cx2, cy2 ] = coord
        const [ px1, py1, px2, py2 ] = prect
        this.rescalex = rescaler([ cx1, cx2 ], [ px1, px2 ], unit)
        this.rescaley = rescaler([ cy1, cy2 ], [ py1, py2 ], unit)
        this.resizex = resizer([ cx1, cx2 ], [ px1, px2 ], unit)
        this.resizey = resizer([ cy1, cy2 ], [ py1, py2 ], unit)
    }

    clone(args: ContextArgs): Context {
        return new Context({ ...this.args, meta: this.meta, ...args })
    }

    // map point from coord to pixel
    mapPoint(cpoint: Point | MPoint, offset: boolean = true): Point {
        const [ cx, cy ] = cpoint
        return [ this.rescalex(cx, offset), this.rescaley(cy, offset) ]
    }

    // map rect from coord to pixel
    mapRect(crect: Rect, offset: boolean = true): Rect {
        const [ x1, y1, x2, y2 ] = crect
        return [
            this.rescalex(x1, offset), this.rescaley(y1, offset),
            this.rescalex(x2, offset), this.rescaley(y2, offset),
        ]
    }

    // map size from coord to pixel
    mapSize(csize: Point, offset: boolean = true): Point {
        const [ sw, sh ] = csize
        return [ this.resizex(sw, offset), this.resizey(sh, offset) ]
    }

    // NOTE: this is the main mapping function! be very careful when changing it!
    map({ rect, aspect0: aspect, expand = false, align = 'center' as Align, upright = false, rotate = 0, rotate_adjust = false, rotate_invar = false, offset = true, coord = D.coord } = {} as Spec & MapArgs): Context {
        // get true pixel rect (default to parent coord)
        const prect0 = this.mapRect(rect ?? this.coord, offset)
        const [ x0, y0, w0, h0 ] = rect_cbox(prect0)

        // degenerate (zero-size) dimensions inherit their orientation from the parent
        const [ pw, ph ] = rect_size(this.prect)
        const [ sw, sh ] = [ heavisign(w0 || pw), heavisign(h0 || ph) ]

        // possibly adjust rotate for aspect ratio (fall back to aspect frame if degenerate)
        const degen = (w0 == 0 || h0 == 0) && aspect != null
        const frame: Size = degen ? [ sw * aspect, sh ] : [ w0, h0 ]
        const rotate1 = rotate_adjust ? adjust_rotate(rotate, frame, coord) : rotate

        // rotate rect inside
        const [ w1, h1 ] = rotate_rect([ abs(w0), abs(h0) ], rotate1, { aspect, expand, rotate_invar })
        const [ w, h ] = [ sw * w1, sh * h1 ]
        const transform = rotate1 ? rotate_repr(rotate1, [ x0, y0 ], this.prec) : undefined

        // broadcast align into [ halign, valign ] components
        const [ hafrac, vafrac ] = ensure_pair(align).map(align_frac)
        const [ x, y ] = [
            x0 + (0.5 - hafrac) * (w - w0),
            y0 + (0.5 - vafrac) * (h - h0),
        ]

        // return new context
        const prect1 = cbox_rect([ x, y, w, h ])
        const prect = upright ? upright_rect(prect1)! : prect1
        return new Context({ prect, coord, transform, prec: this.prec, meta: this.meta, unit: this.unit })
    }
}

//
// attributes
//

function demangle(k: string): string {
    return k.replace('_', '-')
}

function escape_text(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function escape_attr(s: string): string {
    return escape_text(s)
        .replace(/"/g, '&quot;')
}

function props_repr(d: Attrs, prec: number): string {
    return Object.entries(d)
        .filter(([_k, v]) => v != null)
        .map(([k, v]) => `${demangle(k)}="${escape_attr(rounder(v, prec))}"`)
        .join(' ')
}

// reserved keys: the placement spec, the layout protocol's (a size of the
// element's own in em, its share of a stack, and the internal offer a
// container is rebuilt for), and the conveniences
const SPEC_KEYS = [ 'rect', 'coord', 'aspect', 'aspect0', 'expand', 'align', 'upright', 'offset', 'rotate', 'rotate_adjust', 'rotate_invar', 'width', 'height', 'share', 'fit', 'offer' ]
const HELP_KEYS = [ 'pos', 'size', 'xsize', 'ysize', 'rad', 'xrad', 'yrad', 'xrect', 'yrect', 'flex', 'spin', 'orient' ]
const RESERVED_KEYS = [ ...SPEC_KEYS, ...HELP_KEYS ]

// the keys a parent sets to place a child (see Element.clone)
const PLACE_SPEC_KEYS = [ 'rect', 'align', 'expand' ]
const PLACE_ATTR_KEYS: string[] = []

function spec_split(attr: Attrs, extended: boolean = true): [Attrs, Attrs] {
    const SPLIT_KEYS = extended ? RESERVED_KEYS : SPEC_KEYS
    const spec  = filter_object(attr, (k: string, v: any) => v != null &&  SPLIT_KEYS.includes(k))
    const attr1 = filter_object(attr, (k: string, v: any) => v != null && !SPLIT_KEYS.includes(k))
    return [ spec, attr1 ]
}

//
// element class
//

function is_element(x: any): x is Element {
    return x instanceof Element
}

interface SpecArgs {
    rect?: Rect
    coord?: Rect | 'auto'
    aspect?: number | 'auto'
    aspect0?: number
    expand?: boolean
    align?: Align
    upright?: boolean
    rotate?: number
    rotate_invar?: boolean
    rotate_adjust?: boolean
    width?: number
    height?: number
    share?: number
    fit?: boolean
    offer?: Offer
}

// TODO: children should be Element[] | string
interface ElementArgs extends SpecArgs {
    tag?: string
    unary?: boolean
    children?: any
    pos?: Point
    size?: number | Size
    xsize?: number
    ysize?: number
    rad?: number | Size
    xrad?: number
    yrad?: number
    xrect?: number | Limit
    yrect?: number | Limit
    flex?: boolean
    spin?: number
    orient?: number
    debug?: boolean
    env?: Env
    [key: string]: any
}

// the layout protocol (see lib/layout.ts): what a container asks of a child.
// a Laid is the element to place and its box in the container's em
type Laid = LaidItem<Element>

// stroke lengths are given in stroke units (see Context.unit) and resolved to
// pixels at emit time; a dash array is a list of them
const STROKE_KEYS = [ 'stroke_width', 'stroke_dasharray', 'stroke_dashoffset' ]
const scale_stroke = (v: number | number[], unit: number) => Array.isArray(v) ? v.map(x => x * unit) : v * unit

// NOTE: if children gets here, it was ignored by the constructor (so dump it)
class Element {
    args: Attrs
    tag: string
    unary: boolean
    spec: Spec
    attr: Attrs
    declare em?: EmSpec // em metrics, set by measured content (never initialized, so `'em' in x` stays honest)

    constructor(args: ElementArgs = {}) {
        const { tag, unary, children, pos, size: size0, xsize: xsize0, ysize: ysize0, rad, xrad, yrad, xrect, yrect, flex, spin, orient, env: _env, ...attr0 } = args
        const [ spec, attr ] = spec_split(attr0, false)
        this.args = args

        // check for required keys
        if (tag == null) throw new Error('tag is required')
        if (unary == null) throw new Error('unary is required')

        // core display
        this.tag = tag
        this.unary = unary

        // store layout params
        this.spec = spec
        this.attr = attr

        // handle pos/rad/xrad/yrad conveniences
        const [ x, y ] = pos ?? D.pos
        const size = rad != null ? mul2(rad, 2) : size0
        const xsize = xrad != null ? 2 * xrad : xsize0
        const ysize = yrad != null ? 2 * yrad : ysize0

        // handle rect conveniences
        if (this.spec.rect != null) {
            // already have a rect
        } else if (size != null) {
            const [ w, h ] = ensure_pair(size)
            this.spec.rect = cbox_rect([ x, y, w, h ])
        } else if (xrect != null || yrect != null) {
            const xrect1 = ensure_pair(xrect ?? x)
            const yrect1 = ensure_pair(yrect ?? y)
            this.spec.rect = join_limits({ h: xrect1, v: yrect1 })
            if (xrect == null || yrect == null) this.spec.expand = true
        } else if (xsize != null || ysize != null) {
            const [ w, h ] = ensure_pair([ xsize ?? 0, ysize ?? 0 ])
            this.spec.rect = cbox_rect([ x, y, w, h ])
            if (xsize == null || ysize == null) this.spec.expand = true
        }

        // various convenience conversions
        if (spin != null) { this.spec.rotate = spin; this.spec.rotate_invar = true }
        if (orient != null) { this.spec.rotate = orient; this.spec.rotate_adjust = true }
        if (flex === true) this.spec.aspect = undefined

        // adjust aspect for rotation
        this.spec.aspect0 ??= this.spec.aspect
        this.spec.aspect = this.spec.rotate_invar ? this.spec.aspect0 : rotate_aspect(this.spec.aspect0, this.spec.rotate)

        // warn if children are passed
        if (children != null) console.error(`Got children in ${this.constructor.name}`)
    }

    // the Env the element was constructed against, from its outermost args
    // (every element stores the args it was given after super, so a subclass
    // that builds fresh args for super still reports the Env it got)
    get env(): Env {
        return resolveEnv(this.args.env)
    }

    // a clone is the element rebuilt from its args with the overrides applied.
    // when the overrides are only the placement keys a parent sets to put a
    // child in its box, it is a shallow copy with those keys swapped instead:
    // rect, align, and expand go to the spec, which only the parent's context
    // mapping reads, so no constructor sees them and the rest of the element
    // (its children, metrics, em box) carries over as is. layout
    // clones its children this way many times over, and a reconstruction
    // re-runs everything below (text wrapping, math parsing), so this is what
    // keeps deep layouts cheap. an unset placement key goes the long way, as
    // the constructor may derive it from a convenience like pos and size
    clone(args: Attrs = {}): Element {
        const keys = Object.keys(args)
        const cheap = keys.every(k => PLACE_ATTR_KEYS.includes(k) || (PLACE_SPEC_KEYS.includes(k) && args[k] != null))
        if (!cheap) return this.rebuild({ ...this.args, ...args })
        const copy: Element = Object.assign(Object.create(Object.getPrototypeOf(this)), this)
        copy.args = { ...this.args, ...args }
        copy.spec = { ...this.spec }
        copy.attr = { ...this.attr }
        for (const k of keys) {
            const target: Attrs = PLACE_SPEC_KEYS.includes(k) ? copy.spec : copy.attr
            if (args[k] != null) target[k] = args[k]
            else delete target[k]
        }
        return copy
    }

    // Rebuild from the merged constructor args. Adapters can restore their
    // metadata here; placement-only clones bypass this method entirely.
    rebuild(args: Attrs): Element {
        return new (this.constructor as any)(args)
    }

    //
    // layout protocol: what a container asks of a child (see lib/layout.ts).
    // everything is in the parent's em: an element with a `scale` lays itself
    // out in its own em and reports its box scaled
    //

    // the element's em over its parent's
    get scale(): number {
        return this.em?.scale ?? this.args.scale ?? 1
    }

    // its fraction of a stack's length along the axis, if any
    get share(): number | undefined {
        return this.spec.share
    }

    // where it sits in its slot, as [ horizontal, vertical ], in place of the
    // container's justify or valign
    get align(): [ AlignValue | undefined, AlignValue | undefined ] | undefined {
        const align = this.spec.align
        return align != null ? ensure_pair(align) as [ AlignValue, AlignValue ] : undefined
    }

    // a size of its own, in the parent's em
    private own_size(): [ number | undefined, number | undefined ] {
        const s = this.scale
        const { width, height } = this.spec
        return [ width != null ? width * s : undefined, height != null ? height * s : undefined ]
    }

    // the sizes it can come out at with nothing said: a formula is its box, a
    // shape any size at its aspect, anything else any size at all. content
    // (text) overrides this with the range it can be laid out in
    natural(): Bounds {
        if (this.em == null) return {
            ...FREE_BOUNDS,
            aspect: this.spec.aspect,
        }
        return {
            width: point(this.em.width),
            height: point(this.em.height),
        }
    }

    // an element with metrics and `fit` is scaled to its slot like a figure
    // (text in a share stack, a formula in a title's share): a ray at its box's
    // aspect
    private fitted(): EmSpec | undefined {
        return (
            this.spec.fit &&
            this.em != null &&
            this.em.width > 0 &&
            this.em.height > 0
        ) ? this.em : undefined
    }

    // the bounds a container reads: the natural ones, or pinned to a point on
    // an axis by a size of the element's own (and on the other through the
    // tie, or for content by laying it out at that width)
    bounds(): Bounds {
        const fit = this.fitted()
        const b: Bounds = fit != null ? {
            ...FREE_BOUNDS,
            aspect: fit.width / fit.height
        } : this.natural()
        const [ w, h ] = this.own_size()
        if (w != null && h != null) {
            return { width: point(w), height: point(h) }
        } else if (w != null) {
            const hh = b.aspect != null ? point(tie_height(b, w)) : b.height[1] < INF ? point(this.place({ width: w }).em.height) : b.height
            return { ...b, width: point(w), height: hh }
        } else if (h != null) {
            const ww = b.aspect != null ? point(tie_width(b, h!)) : b.width
            return { ...b, width: ww, height: point(h!) }
        } else {
            return b
        }
    }

    // the element laid out for an offer of a width and/or height: the element
    // to place and its box. an element with metrics keeps its size (shrunk to
    // the slot if wider), one with an aspect fits the offer at it (nothing
    // offered: one em tall), and one with neither fills it (one side offered:
    // a square on it)
    place(offer: Offer = {}): Laid {
        const { width, height } = offer
        if (this.em != null) {
            const { width: width0 } = this.em
            const f = (width != null && width0 > width + EPS) ? width / width0 : 1
            return {
                elem: this,
                em: make_em(scale_em_spec(this.em, f)),
            }
        }
        const { aspect } = this.spec
        let w: number, h: number
        if (aspect != null && aspect > 0) {
            // embed aspected content into the offer dimensions
            if (width != null && height != null) {
                w = Math.min(width, height * aspect)
                h = w / aspect
            }
            else if (width != null) {
                w = width
                h = w / aspect
            }
            else if (height != null) {
                h = height
                w = h * aspect
            }
            else {
                h = 1
                w = aspect
            }
        } else {
            // a stretch fills what it is offered; offered one side it is
            // square, offered nothing one em square
            w = width ?? height ?? 1
            h = height ?? w
        }
        return {
            elem: this,
            em: make_em({ width: w, height: h, anchor: 0.5 * h }),
        }
    }

    // lay applies a size of the element's own over the offer, and makes the
    // box that size whatever the content did (the content sits in it by the
    // element's align); subclasses override place
    lay(offer: Offer = {}): Laid {
        const [ w, h ] = this.own_size()
        const fit_em = this.fitted()
        const width = w ?? offer.width
        const height = h ?? offer.height
        const laid = fit_em != null ?
            fit_laid(this, fit_em, { width, height }) :
            this.place({ ...offer, width, height })
        const fill = offer.fill && offer.width != null && w == null ? offer.width : undefined
        if (w == null && h == null && fill == null) return laid
        return box_laid(laid, w ?? fill ?? laid.em.width, h ?? laid.em.height, this.spec.align)
    }

    rect(ctx: Context): Rect {
        const { prect } = ctx.map(this.spec)
        return remap_rect(prect, ctx.prect, ctx.coord)
    }

    graphCoord(): Rect | undefined {
        return this.spec.rect ?? this.spec.coord
    }

    anchor(ctx: Context, side: Side, loc: number = 0.5): Point {
        const prect = this.rect(ctx)
        return anchor_point(prect, side, loc)
    }

    props(ctx: Context): Attrs {
        const { transform, unit } = ctx
        const attr: Attrs = transform != null ? { ...this.attr, transform } : { ...this.attr }
        for (const k of STROKE_KEYS) if (attr[k] != null) attr[k] = scale_stroke(attr[k], unit)
        return attr
    }

    inner(_ctx: Context): string {
        return ''
    }

    svg(ctx?: Context): string {
        // default context
        ctx ??= new Context()

        // collect all properties
        const pvals = this.props(ctx)
        const props = props_repr(pvals, ctx.prec)
        const pre = props.length > 0 ? ' ' : ''

        // return final svg
        if (this.unary) {
            return `<${this.tag}${pre}${props} />`
        } else {
            return `<${this.tag}${pre}${props}>${this.inner(ctx)}</${this.tag}>`
        }
    }
}

//
// children geometry
//

function rotated_vertices(rect: Rect, rotate: number | undefined): Point[] {
    // handle zero case first
    if (rotate == null || rotate == 0) {
        const [ x1, y1, x2, y2 ] = rect
        return [ [ x1, y1], [ x2, y2 ] ]
    }

    // get vertices of rect
    const [ cx, cy, rw, rh ] = rect_radial(rect)
    const verts = [
        [-rw, -rh], [ rw, -rh],
        [-rw,  rh], [ rw,  rh],
    ]

    // return rotated vertices
    const theta = d2r * rotate
    const [ SIN, COS ] = [ sin(theta), cos(theta) ]
    return verts.map(([ dx, dy ]) => [
        cx + dx * COS - dy * SIN,
        cy + dx * SIN + dy * COS,
    ])
}

// NOTE: we disable absolute offsets to compute auto aspect
function children_rect(children: Element[], offset: boolean = false): Rect | undefined {
    if (children.length == 0) return

    // get post-rotated vertices of children
    const ctx = new Context()
    const verts = children.flatMap(c => {
        const spec = { ...c.spec, offset }
        const { prect } = ctx.map(spec)
        const prect0 = ctx.mapRect(c.spec.rect ?? ctx.coord, offset)
        const rot0 = c.spec.rotate ?? 0
        const rot1 = c.spec.rotate_adjust ? adjust_rotate(rot0, rect_size(prect0), c.spec.coord ?? D.coord) : rot0
        const rot = c.spec.rotate_invar ? 0 : rot1
        return rotated_vertices(prect, rot)
    })

    // find enclosing rect for vertices
    return merge_points(verts)
}

function children_aspect(children: Element[]): number | undefined {
    if (children.length == 1) {
        const { aspect } = children[0].spec
        return aspect
    }
}

//
// group class
//

function ensure_children(children: any): Element[] {
    return (children ?? []).filter((c: Element) => c != null)
}

// an id for a clip path or mask, drawn from the Env's id stream
function makeUID(prefix: string, env?: Env): string {
    return `${prefix}-${resolveEnv(env).uids.random().toString(36).slice(2, 10)}`
}

// an element with em metrics (text, math, the text containers) placed by
// `pos` with no size of its own
function is_unsized_em(c: Element): c is WithEm {
    const { pos, size, xsize, ysize, rad, xrad, yrad, rect, xrect, yrect } = c.args ?? {}
    return c.em != null && pos != null && [ size, xsize, ysize, rad, xrad, yrad, rect, xrect, yrect ].every(v => v == null)
}

// what a group's `em` (coordinate units per em) does to its children: one
// with metrics placed by `pos` alone is made its em height times `em` tall,
// so text and formulas dropped into a coordinate frame share one size. it
// applies to direct children only, a nested group's coordinates being its own
function size_by_em(children: Element[], em: number | undefined): Element[] {
    if (em == null) return children
    return children.map(c => is_unsized_em(c) ? c.clone({ ysize: em * c.em!.height }) : c)
}

interface GroupArgs extends ElementArgs {
    children?: (Element | null)[]
    coord?: Rect | 'auto'
    clip?: true | Element
    mask?: Element
    em?: number
}

class Group extends Element {
    children: Element[]

    constructor(args: GroupArgs = {}) {
        const { children: children0, aspect: aspect0, coord: coord0, clip: clip0, mask: mask0, em, debug = false, tag = 'g', env, ...attr } = args
        const children = size_by_em(ensure_children(children0), em)

        // handle boolean args
        const clip = clip0 === true ? new Rectangle({ env }) : clip0

        // automatic aspect and coord detection
        const aspect = aspect0 == 'auto' ? children_aspect(children) : aspect0
        const coord = coord0 == 'auto' ? children_rect(children) : coord0

        // create debug boxes
        if (debug) {
            const orects = children.map((c: Element) => new Rectangle({ rect: c.spec.rect, stroke: blue, stroke_width: 2, opacity: 0.75, env }))
            const irects = children.map((c: Element) => new Rectangle({ ...c.spec, stroke: red, stroke_width: 2, opacity: 0.75, env }))
            children.push(...irects, ...orects)
        }

        // make clip path
        let clip_path: string | undefined
        if (clip != null) {
            const clip_id = makeUID('clip', env)
            clip_path = `url(#${clip_id})`
            const clip_elem = new ClipPath({ children: [ clip ], id: clip_id, env })
            children.push(clip_elem)
        }

        // make mask
        let mask: string | undefined
        if (mask0 != null) {
            const mask_id = makeUID('mask', env)
            mask = `url(#${mask_id})`
            const mask_elem = new Mask({ children: [ mask0 ], id: mask_id, env })
            children.push(mask_elem)
        }

        // pass to Element
        super({ tag, unary: false, aspect, coord, clip_path, mask, env, ...attr })
        this.args = args

        // additional props
        this.children = children
    }

    graphCoord(): Rect | undefined {
        const coord = super.graphCoord()
        if (coord != null) return coord
        return merge_rects(
            this.children
                .filter(c => c.spec.rect == null)
                .map(c => c.graphCoord())
        )
    }

    inner(ctx: Context): string {
        const inner = this.children
            .map(c => c.svg(ctx.map(c.spec)))
            .filter(s => s.length > 0)
            .join('\n')
        return `\n${inner}\n`
    }

    svg(ctx?: Context): string {
        ctx ??= new Context()
        const props = this.props(ctx)
        if (Object.keys(props).length == 0) return this.inner(ctx).trim()
        return super.svg(ctx)
    }
}

// an element with metrics scaled into an offer like a figure: as wide as the
// width, as tall as the height, or inside both; nothing offered keeps it
function fit_laid(elem: Element, em0: EmSpec, { width, height }: Offer): Laid {
    const aspect = em0.width / em0.height
    let w: number
    if (width != null && height != null) w = Math.min(width, height * aspect)
    else if (width != null) w = width
    else if (height != null) w = height * aspect
    else w = em0.width
    return { elem, em: make_em(scale_em_spec(em0, w / em0.width)) }
}

// a laid element placed in a box of a size by align (centered by default),
// inside the insets [ left, top, right, bottom ]: the placed clone, for a
// group with the box as its coord, and the content's anchor in the box
function place_in_box(laid: Laid, width: number, height: number, align?: Align, insets: Rect = [ 0, 0, 0, 0 ]): { child: Element, anchor: number } {
    const { elem, em } = laid
    const [ l, t, r, b ] = insets
    const [ ha, va ] = (align != null ? ensure_pair(align) : [ 'center', 'center' ]).map(a => align_frac(a as AlignValue))
    const x = l + ha * (width - l - r - em.width)
    const y = t + va * (height - t - b - em.height)
    const child = elem.clone({ rect: em_rect(em, x, y + em.anchor) })
    return { child, anchor: y + em.anchor }
}

// a laid element boxed at a size: as it is when its box is that size, else
// placed in a group of that size by align, which reports the box and the
// content's anchor
function box_laid(laid: Laid, width: number, height: number, align?: Align): Laid {
    const { elem, em } = laid
    if (Math.abs(em.width - width) < EPS && Math.abs(em.height - height) < EPS) return laid
    const { child, anchor } = place_in_box(laid, width, height, align)
    const boxed = make_em({ width, height, anchor, scale: em.scale })
    const group = new Group({ children: [ child ], ...em_frame(boxed), upright: true, env: elem.env })
    group.em = boxed
    return { elem: group, em: boxed }
}

//
// metadata classes
//

class ClipPath extends Group {
    constructor(args: GroupArgs = {}) {
        const { children, ...attr } = args
        super({ tag: 'clipPath', children, ...attr })
        this.args = args
    }

    svg(ctx?: Context): string {
        ctx ??= new Context()
        const def = super.svg(ctx)
        ctx.meta.addDef(def)
        return ''
    }
}

class Mask extends Group {
    constructor(args: GroupArgs = {}) {
        const { children, ...attr } = args
        super({ tag: 'mask', children, ...attr })
        this.args = args
    }

    svg(ctx?: Context): string {
        ctx ??= new Context()
        const def = super.svg(ctx)
        ctx.meta.addDef(def)
        return ''
    }
}

class Style extends Element {
    text: string

    constructor(args: ElementArgs = {}) {
        const { children , env} = args
        super({ tag: 'style', unary: false, env })
        this.text = children
    }

    svg(_ctx?: Context): string {
        if (this.text.length == 0) return ''
        return `<style>\n${this.text}\n</style>`
    }
}

class Metadata {
    uuid: number
    defs: string[]

    constructor() {
        this.uuid = 0 // next uuid
        this.defs = [] // defs list
    }

    getUid(): string {
        return `uid-${this.uuid++}`
    }

    addDef(def: string): void {
        this.defs.push(def)
    }

    svg(): string {
        if (this.defs.length == 0) return ''
        return `<defs>\n${this.defs.join('\n')}\n</defs>`
    }
}

//
// svg class
//

interface SvgArgs extends GroupArgs {
    size?: number | Size
    padding?: number
    bare?: boolean
    dims?: boolean
    filters?: any
    view?: Rect
    style?: string
    xmlns?: string
    font_family?: string
    font_weight?: number
    prec?: number
    unit_size?: number
    em?: number       // pixels per em offered to the content (default: the size over D.svg_ems)
    width?: number    // the offer in em, instead (the width and height the content is laid out for)
    height?: number
}

// the root: one child with no rect of its own is laid out for the canvas in
// em (see Element.lay) and, with `aspect` auto, the canvas takes the shape
// of the box it comes out as: a figure fills it, a text column wraps to it,
// a paragraph on its own is as wide as its line. the box then fills the
// pixel size, so the em the content was offered is only a starting point:
// `em` (pixels per em) or `width`/`height` (in em) set it
class Svg extends Group {
    size: Size
    viewrect: Rect
    style: Style
    prec: number
    unit_size: number
    dims: boolean

    constructor(args: SvgArgs = {}) {
        const { children: children0, size : size0 = D.svg_size, padding = 1, bare = false, dims = true, filters, aspect: aspect0 = 'auto', view: view0, style, xmlns = svgns, font_family = sans, font_weight = light, stroke_width = 1, prec = D.prec, unit_size = D.unit_size, em: em0, width: width0, height: height0, env, ...attr } = THEME(args, 'Svg')
        const children0_1 = ensure_children(children0)
        const size_base = ensure_pair(size0)

        // lay a lone child out for the canvas in em
        let children = children0_1
        let aspect: number | undefined = aspect0 == 'auto' ? undefined : aspect0
        const only = children.length == 1 && children[0].spec.rect == null ? children[0] : null
        if (only != null) {
            const [ sw, sh ] = size_base.map(abs)
            const em = em0 ?? Math.max(sw, sh) / D.svg_ems
            const laid = only.lay({ width: width0 ?? sw / em, height: height0 ?? sh / em })
            children = [ laid.elem ]
            if (aspect0 == 'auto') aspect = laid.em.height > 0 && laid.em.width > 0 ? laid.em.width / laid.em.height : undefined
        }
        const [ width, height ] = embed_size(size_base, { aspect })

        // compute outer viewBox
        const viewrect0 = view0 ?? [ 0, 0, width, height ]
        const viewrect = expand_rect(viewrect0, padding) as Rect

        // make style element
        const style_elem = new Style({ children: style ?? '', env })

        // pass to Group
        // the root carries the default stroke width as an inherited presentation
        // attribute (like stroke and fill), so strokes with no explicit width
        // still scale with the image instead of staying a fixed pixel hairline
        super({ tag: 'svg', children, aspect, xmlns, font_family, font_weight, stroke_width, env, ...attr })
        this.args = args

        // additional props
        this.size = [ width, height ]
        this.viewrect = viewrect
        this.style = style_elem
        this.prec = prec
        this.unit_size = unit_size
        this.dims = dims
    }

    props(ctx: Context): Attrs {
        const attr = super.props(ctx)
        const { viewrect, size: [ width, height ], dims } = this
        const { prec } = ctx

        // construct viewBox
        const [ x, y, w, h ] = rect_box(viewrect)
        const viewBox = `${rounder(x, prec)} ${rounder(y, prec)} ${rounder(w, prec)} ${rounder(h, prec)}`

        // return attributes; the pixel dimensions are the size, not the em ones
        return { viewBox, ...(dims ? { width, height } : {}), ...attr }
    }

    inner(ctx: Context): string {
        const inner = super.inner(ctx)
        const defs = ctx.meta.svg()
        const style = this.style.svg(ctx)
        const body = [ defs, style, inner ]
            .filter(s => s.length > 0)
            .map(s => s.trim())
            .join('\n')
        return `\n${body}\n`
    }

    svg(args?: ContextArgs): string {
        const { size, prec, unit_size } = this

        // make new context; the stroke unit scales with the image, so a stroke
        // of width 1 is one pixel when the image is unit_size across (the size
        // the image was designed at; D.unit_size by default, so a small icon
        // designed at its own size sets unit_size to that size)
        const [ w, h ] = size
        const prect = [ 0, 0, w, h ] as Rect
        const unit = Math.max(w, h) / unit_size
        const ctx = new Context({ prect, prec, unit, ...args })

        // render children
        return super.svg(ctx)
    }
}

//
// rectangle class
//

interface RectArgs extends ElementArgs {
    rounded?: boolean | number | Size
}

class Rectangle extends Element {
    rounded?: number | Size

    constructor(args: RectArgs = {}) {
        const { rounded, ...attr } = THEME(args, 'Rect')

        // pass to Element
        super({ tag: 'rect', unary: true, ...attr })
        this.args = args

        // additional props
        this.rounded = rounded === false ? 0 : rounded === true ? D.rounded : rounded
    }

    props(ctx: Context): Attrs {
        // get core attributes
        const attr = super.props(ctx)

        // get true pixel rect
        const { prect } = ctx
        let [ x, y, w, h ] = rect_box(prect, true)

        // Corner radii use the same drawing unit as strokes. A scalar stays
        // circular; a pair can be elliptical. Clamp each to the available box.
        let rx: number | undefined
        let ry: number | undefined
        if (this.rounded != null) {
            if (is_scalar(this.rounded)) {
                rx = Math.min(Math.max(0, ctx.unit * this.rounded), 0.5 * Math.min(w, h))
            } else {
                rx = Math.min(Math.max(0, ctx.unit * this.rounded[0]), 0.5 * w)
                ry = Math.min(Math.max(0, ctx.unit * this.rounded[1]), 0.5 * h)
            }
        }

        // output properties
        return { x, y, width: w, height: h, rx, ry, ...attr }
    }
}

//
// spacer class
//

// this can have an aspect, which is utilized by layouts
class Spacer extends Element {
    constructor(args: ElementArgs = {}) {
        const attr = THEME(args, 'Spacer')
        super({ tag: 'g', unary: true, ...attr })
        this.args = args
    }

    svg(_ctx?: Context): string {
        return ''
    }
}

//
// exports
//

export { Context, Element, Group, Svg, Rectangle, Spacer, Mask, ClipPath, Style, Metadata, is_element, ensure_children, size_by_em, spec_split, align_frac, escape_text, box_laid, place_in_box, fit_laid, is_unsized_em }
export type { SpecArgs, ElementArgs, GroupArgs, ContextArgs, SvgArgs, RectArgs, Bounds, Offer, Laid }
