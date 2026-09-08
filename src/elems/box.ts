// boxes: a frame around content, with padding and margin in em

import { THEME } from '../lib/theme'
import { none } from '../lib/const'
import { prefix_split, prefix_join, pad_rect } from '../lib/utils'
import { make_em, scale_em_spec } from '../lib/em'
import type { EmArgs, EmSpec } from '../lib/em'
import { INF, box_bounds, scale_bounds, free_bounds } from '../lib/layout'

import { Group, Rectangle, spec_split, ensure_children, is_element, is_unsized_em, place_in_box } from './core'
import type { Element, GroupArgs, MaybeEm, Bounds, Offer, Laid } from './core'
import { RoundedRect } from './geometry'
import { box_aspect } from './em'
import { Text } from './text'

import type { Rect, Padding, Rounded, AlignValue } from '../lib/types'

// the geometry of a box, in em: its whole size, the framed box (inside the
// margin) and the margins; handed to a clip or mask given as a function
interface BoxGeometry {
    total_w: number
    total_h: number
    box_w: number
    box_h: number
    ml: number
    mt: number
}

interface BoxArgs extends Omit<GroupArgs, 'aspect' | 'clip' | 'mask'>, EmArgs {
    padding?: Padding            // inside the border, in em; true for the default
    margin?: Padding             // outside the border, in em; true for the default
    border?: boolean | number    // the frame's stroke width; true for 1
    fill?: string                // the background color
    shape?: Element              // the shape of the frame (a rectangle, rounded when `rounded`)
    rounded?: Rounded            // corner radii in stroke units; true for the default
    aspect?: number | boolean    // the shape of the framed box; true for square
    clip?: true | Element | ((g: BoxGeometry) => Element)   // clip to the frame, or to an element (in em; a function of the geometry)
    mask?: Element | ((g: BoxGeometry) => Element)          // a mask (in em; a function of the geometry)
    justify?: AlignValue         // the text alignment, and where content narrower than the box sits
    width?: number               // the box's outer size in em, which it spans
    height?: number
    font_family?: string
    font_weight?: number
    font_style?: string
}

// the size an offer gives an element of an aspect: inside both, spanning the
// one given, or one em tall when nothing is
function fit_offer(aspect: number, { width, height }: Offer): [ number, number ] {
    const [ W, H ] = [ width != null ? Math.max(width, 0) : undefined, height != null ? Math.max(height, 0) : undefined ]
    if (W != null && H != null) { const w = Math.min(W, H * aspect); return [ w, w / aspect ] }
    if (W != null) return [ W, W / aspect ]
    if (H != null) return [ H * aspect, H ]
    return [ aspect, 1 ]
}

// insets in em from a padding or margin: a boolean is the default, or none
function box_insets(p: Padding | undefined, dflt: number): Rect {
    return pad_rect(p === true ? dflt : (p == null || p === false) ? 0 : p)
}

// a box around its content, with `padding` inside the border and `margin`
// outside, both in em. the content is the children with no rect of their own
// (elements: TextBox sets strings as text), with the box's font and text
// settings handed down; a child at a rect of its own is placed by it relative
// to the area inside the padding, as in a group, and one with metrics placed
// by `pos` alone is at its own size there (a title on the border of an
// unpadded box, say). the box
// hugs its content plus the padding: laid out for a size (by the Svg, a stack
// or another box) the content is laid out for the area inside the padding, so
// a column keeps its text size and hugs its height, a figure spans the width
// and a paragraph wraps to it; nothing offered, the content is at its natural
// size. a `width` or `height` of its own is the box's outer size, which it
// spans. an `aspect` makes the box a figure of that shape: sized by what it
// is offered with the content fit into the area (as any figure's content
// is), or grown around the content when nothing is; `flex` fills the offer.
// the border and corner radii are in stroke units
class Box extends Group {
    em: EmSpec
    content: Element[]
    insets: [ number, number ]
    margins: [ number, number ]
    aspect_box: number | undefined

    constructor(args: BoxArgs = {}) {
        const { children: children0, padding: padding0, margin: margin0, border, fill, shape: shape0, rounded: rounded0, aspect: aspect0, clip, mask, justify: justify0, width, height, scale = 1, offer, env, ...attr0 } = THEME(args, 'Box')
        const [ border_attr, fill_attr, font_attr0, text_attr, attr1 ] = prefix_split([ 'border', 'fill', 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const [ spec, attr ] = spec_split(attr1)
        const children = ensure_children(children0)
        const aspect = aspect0 === true ? 1 : aspect0 === false ? undefined : aspect0
        const rounded = rounded0 === false ? undefined : rounded0
        const fixed = aspect != null || spec.flex === true

        // the insets, in em
        const [ pl, pt, pr, pb ] = box_insets(padding0, 0.5)
        const [ ml, mt, mr, mb ] = box_insets(margin0, 0.5)
        const insets: [ number, number ] = [ pl + pr + ml + mr, pt + pb + mt + mb ]

        // the content: the children with no rect of their own; the rest are
        // placed by their rects. content narrower than the area sits in it by
        // justify, centered by default; a justify given is also the text
        // alignment handed down
        if (children.some(c => !is_element(c))) throw new Error('Box takes elements: wrap text in <Text>, or use a TextBox')
        const placed_by = (c: Element) => c.spec.rect != null || is_unsized_em(c)
        const content = children.filter(c => !placed_by(c))
        const decor = children.filter(placed_by)
        const justify = justify0 ?? 'center'

        // the outer size the box spans on an axis: its own, or the offer's (in
        // the box's em) when its shape is its own (see place). the first
        // content child is laid out for the area inside the insets, and the
        // box spans, or hugs what it came to; an aspect grows a hugging box
        const outer_w = width ?? (offer?.width != null ? offer.width / scale : undefined)
        const outer_h = height ?? (offer?.height != null ? offer.height / scale : undefined)
        const span_w = width != null || (fixed && outer_w != null)
        const span_h = height != null || (fixed && outer_h != null)
        const room = (outer: number | undefined, inset: number) => outer != null ? Math.max(outer - inset, 0) : undefined
        const lay = (c: Element, w: number | undefined, h: number | undefined): Laid => c.lay({ width: w, height: h, attr: { ...font_attr, ...text_attr }, fit: fixed || undefined, ...(justify0 != null ? { justify: justify0 } : {}) })
        const first = content.length > 0 ? lay(content[0], room(outer_w, insets[0]), room(outer_h, insets[1])) : null
        const [ cw, ch ] = first != null ? [ first.em.width, first.em.height ] : [ room(outer_w, insets[0]) ?? 1, room(outer_h, insets[1]) ?? 1 ]
        let box_w = span_w ? outer_w! - ml - mr : cw + pl + pr
        let box_h = span_h ? outer_h! - mt - mb : ch + pt + pb
        if (aspect != null && !(span_w && span_h)) {
            if (box_w / box_h < aspect) box_w = aspect * box_h
            else box_h = box_w / aspect
        }
        const total_w = box_w + ml + mr
        const total_h = box_h + mt + mb
        const geometry: BoxGeometry = { total_w, total_h, box_w, box_h, ml, mt }

        // the rest of the content laid out for the area. the content placed in
        // the area: fit into it when the box has a shape of its own (as any
        // figure's content), else at its size by justify
        const area: Rect = [ ml + pl, mt + pt, ml + pl + box_w - pl - pr, mt + pt + box_h - pt - pb ]
        const rest = content.slice(1).map(c => lay(c, area[2] - area[0], area[3] - area[1]))
        const laid = first != null ? [ first, ...rest ] : []
        const placed = laid.map(l => fixed ? { child: l.elem.clone({ rect: area, align: justify }), anchor: 0.5 * total_h } : place_in_box(l, total_w, total_h, [ justify, 'center' ], [ ml + pl, mt + pt, mr + pr, mb + pb ]))
        const anchor = placed.length > 0 ? placed[0].anchor : 0.5 * total_h

        // the background and the frame at the framed box; the children of
        // their own rects placed relative to the area inside the padding, one
        // with metrics placed by pos alone at its own size; the clip and the
        // mask in em
        const shape_rect: Rect = [ ml, mt, ml + box_w, mt + box_h ]
        const shape = shape0 ?? (rounded != null ? new RoundedRect({ rounded, env }) : new Rectangle({ env }))
        const background = fill != null ? shape.clone({ rect: shape_rect, fill, stroke: none, ...fill_attr }) : null
        const frame = (border != null && border !== false) ? shape.clone({ rect: shape_rect, stroke_width: border === true ? 1 : border, fill: none, ...border_attr }) : null
        const [ ax, ay, aw, ah ] = [ area[0], area[1], area[2] - area[0], area[3] - area[1] ]
        const em_rect = (c: Element): Rect => {
            if (is_unsized_em(c)) {
                const [ px, py ] = c.args.pos as [ number, number ]
                const { width: w, height: h } = (c as MaybeEm).em!
                const [ cx, cy ] = [ ax + px * aw, ay + py * ah ]
                return [ cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2 ]
            }
            const [ x0, y0, x1, y1 ] = c.spec.rect!
            return [ ax + x0 * aw, ay + y0 * ah, ax + x1 * aw, ay + y1 * ah ]
        }
        const others = decor.map(c => c.clone({ rect: em_rect(c) }))
        const em_coord: Rect = [ 0, 0, total_w, total_h ]
        const in_em = (e: Element): Element => (e instanceof Group && e.spec.coord == null) ? e.clone({ coord: em_coord }) : new Group({ children: [ e ], coord: em_coord, env })
        const clip_elem = clip == null ? undefined : in_em(clip === true ? shape.clone({ rect: shape_rect }) : typeof clip == 'function' ? clip(geometry) : clip)
        const mask_elem = mask == null ? undefined : in_em(typeof mask == 'function' ? mask(geometry) : mask)

        // pass to Group
        super({ children: [ background, ...placed.map(p => p.child), frame, ...others ], coord: [ 0, 0, total_w, total_h ], aspect: box_aspect(total_w, total_h), clip: clip_elem, mask: mask_elem, upright: true, env, ...attr, ...spec, width, height })
        this.args = args
        this.em = make_em(scale_em_spec({ width: total_w, height: total_h, anchor, scale: 1 }, scale))
        this.content = content
        this.insets = insets
        this.margins = [ ml + mr, mt + mb ]
        this.aspect_box = aspect
    }

    // the content's bounds shifted by the insets (its tie kept), at the box's
    // scale; a box of an aspect is any size at it, its margins outside; a flex
    // box is free; one without content is its size
    natural(): Bounds {
        const s = this.em.scale
        if (this.aspect_box != null) {
            const [ mx, my ] = this.margins
            return { width: [ 0, INF ], height: [ 0, INF ], aspect: this.aspect_box, offset: [ mx * s, my * s ] }
        }
        if (this.args.flex === true) return free_bounds()
        if (this.content.length == 0) return super.natural()
        return scale_bounds(box_bounds(this.content[0].bounds(), this.insets), s)
    }

    // laid out again for the offer: a box of an aspect at the size that fits
    // it (margins outside), a flex one filling it, else with its content laid
    // out for it; a filled slot is the box's own width, so the frame spans it,
    // and a text alignment handed down reaches a text content.
    // nothing offered: as it is. rotated: a figure, fit by its bounds
    place(offer: Offer = {}): Laid {
        const { width, height, fill, justify, attr = {} } = offer
        if (width == null && height == null) return super.place(offer)
        if (this.spec.rotate) {
            const [ w, h ] = fit_offer(this.spec.aspect ?? 1, offer)
            return { elem: this, em: make_em({ width: w, height: h, anchor: 0.5 * h }) }
        }
        const s = this.em.scale
        const fixed = this.aspect_box != null || this.args.flex === true
        let size: Offer = { width, height }
        if (this.aspect_box != null) {
            const [ mx, my ] = this.margins
            const [ bw, bh ] = fit_offer(this.aspect_box, { width: width != null ? width - mx * s : undefined, height: height != null ? height - my * s : undefined })
            size = { width: bw + mx * s, height: bh + my * s }
        } else if (fixed) {
            size = { width: width ?? height, height: height ?? width }
        }
        const justify_attr = (justify != null && this.args.justify == null && this.content[0] instanceof Text) ? { justify } : {}
        const own = (fill && width != null && this.args.width == null && !fixed) ? { width: width / s, offer: { height } } : { offer: size }
        const elem = this.clone({ ...attr, ...justify_attr, ...own }) as Box
        return { elem, em: elem.em }
    }
}

// a box with a border
class Frame extends Box {
    constructor(args: BoxArgs = {}) {
        const { border = 1, ...attr } = THEME(args, 'Frame')
        super({ border, ...attr })
        this.args = args
    }
}

// the same boxes for a box around text: strings among the children (with
// any inline elements) are set as a Text, aligned left by default; the
// padding default is for text
function text_children(args: BoxArgs): BoxArgs {
    const children = ensure_children(args.children)
    const textual = children.some(c => !is_element(c))
    return textual ? { justify: 'left', ...args, children: [ new Text({ children, env: args.env }) ] } : args
}

class TextBox extends Box {
    constructor(args: BoxArgs = {}) {
        super(THEME(text_children(args), 'TextBox'))
        this.args = args
    }
}

class TextFrame extends Frame {
    constructor(args: BoxArgs = {}) {
        super(THEME(text_children(args), 'TextFrame'))
        this.args = args
    }
}

type TextBoxArgs = BoxArgs
type TextFrameArgs = BoxArgs

export { Box, Frame, TextBox, TextFrame, box_insets }
export type { BoxArgs, BoxGeometry, TextBoxArgs, TextFrameArgs }
