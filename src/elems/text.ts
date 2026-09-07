// text elements

import type { Attrs, AlignValue, Rect, Limit } from '../lib/types'
import { resolveEnv } from '../lib/default'
import type { Env } from '../env'
import { THEME } from '../lib/theme'
import { none, bold, mono, vtext, maxis } from '../lib/const'
import { check_string, is_scalar, is_string, is_boolean, compress_whitespace, rect_box, check_singleton, prefix_split, prefix_join, sum, max, ensure_pair } from '../lib/utils'
import { textMetrics, splitWords } from '../lib/text'
import type { TextMetrics, Whitespace } from '../lib/text'
import { wrapWidths } from '../lib/wrap'
import { make_em, em_bounds, em_hink, em_rect, scale_em_spec } from '../lib/em'
import type { EmArgs, EmSpec, EmMetrics } from '../lib/em'

import { Context, Element, Group, Spacer, Rectangle, spec_split, ensure_children, escape_text, is_element, align_frac } from './core'
import { ensure_em_spec, with_em } from './em'
import type { WithEm } from './em'
import type { ElementArgs, GroupArgs } from './core'
import { Box, HStack, VStack } from './layout'
import type { BoxArgs, StackArgs } from './layout'
import { layout_reflow, child_align, row_offsets } from './sizing'
import type { LayoutOffer, LayoutResult, RowAlign } from '../lib/layout'

//
// span class
//

interface SpanArgs extends ElementArgs {
    whitespace?: Whitespace
    children?: string[]
    color?: string
    stroke?: string
    vshift?: number
    font_family?: string
    font_weight?: number
    font_style?: string
}

// the output attributes for a font: the bold and italic KaTeX faces are
// addressed by base family plus weight and style (see fontFace)
function font_css({ font_family, font_weight, font_style }: { font_family?: string, font_weight?: number, font_style?: string }, env?: Env): Attrs {
    if (font_family == null) return {}
    const face = resolveEnv(env).fonts.face(font_family)
    if (face.family == font_family) return {}
    return { font_family: face.family, font_weight: face.weight ?? font_weight, font_style: face.style ?? font_style }
}

class Span extends Element {
    text: string
    metrics: TextMetrics
    vshift: number

    constructor(args: SpanArgs = {}) {
        const { children: children0, color, whitespace = 'normal', vshift = vtext, stroke = none, env, ...attr0 } = THEME(args, 'Span')
        const text0 = check_string(children0)
        const [ font_attr0, attr ] = prefix_split([ 'font' ], attr0)
        const font_attr = prefix_join('font', font_attr0)

        const preserve = whitespace === 'pre' || whitespace === 'preserve'
        const text = preserve ? text0 : compress_whitespace(text0)
        const { advance, vrange, raw_vrange = vrange, italic = 0 } = textMetrics(text, { ...font_attr, whitespace, env })

        // adjust metrics for vertical shift
        const [ ymin, ymax ] = vrange
        const [ raw_ymin, raw_ymax ] = raw_vrange
        const vrange_shift: Limit = [ ymin + vshift, ymax + vshift ]
        const raw_vrange_shift: Limit = [ raw_ymin + vshift, raw_ymax + vshift ]
        const metrics = { advance, vrange: vrange_shift, raw_vrange: raw_vrange_shift, italic }

        // pass to element; the font is measured by its registry name but named
        // in the output by its css face (family plus weight and style)
        super({ tag: 'text', unary: false, aspect: advance, fill: color, stroke, ...font_attr, ...font_css(font_attr, env), ...attr, ...(preserve ? { 'xml:space': 'preserve' } : {}) })
        this.args = args

        // additional props
        this.text = text
        this.metrics = metrics
        this.vshift = vshift
    }

    // because text will always be displayed upright,
    // we need to find the ordered bounds of the text
    // and then offset it by the given offset
    props(ctx: Context): Attrs {
        const attr = super.props(ctx)

        // compute glyph rect without vshift (apply vshift in pixel space)
        const { vrange: [ ymin, ymax ] } = this.metrics
        const vshift = this.vshift
        const glyph_rect: Rect = [ 0, ymin - vshift, 1, ymax - vshift ]
        const rect = ctx.mapRect(glyph_rect)

        // get position and size
        const [ x, y0, _w, h ] = rect_box(rect, true)
        const y = y0 + (1 + vshift) * h

        // get adjusted size
        return { x, y, font_size: `${h}px`, ...attr }
    }

    inner(_ctx: Context): string {
        return escape_text(this.text)
    }
}

interface ElemSpanArgs extends GroupArgs {
    spacing?: boolean | number
}

// elements with em metrics (math, see lib/em.ts) are placed in the line by
// them; the line box is 1em tall with the text baseline at 1 + vtext, so the
// math axis sits maxis above that
const INLINE_MATH_AXIS = 1 + vtext - maxis

// place an element with em metrics in a 1em line box: 1em of its content is 1
// line height, its anchor is pinned to the line's axis, and a tall formula
// overflows the line rather than shrinking to fit it (as in TeX). returns the
// ink width in em along with the positioned child
function place_inline_em(child: WithEm, spacing: number): [ Element, number ] {
    const [ xlo, xhi ] = em_hink(child.em)
    const [ ylo, yhi ] = em_bounds(child.em)
    const width = xhi - xlo
    const aspect = width + spacing
    const xfrac = aspect > 0 ? width / aspect : 1
    const y0 = INLINE_MATH_AXIS + ylo
    const y1 = INLINE_MATH_AXIS + yhi
    const rect: Rect = [ 0, y0, xfrac, y1 ]
    return [ child.clone({ rect, align: 'left' }), aspect ]
}

class ElemSpan extends Group {
    constructor(args: ElemSpanArgs = {}) {
        const { children: children0, spacing: spacing0 = true, ...attr } = args
        const child0 = check_singleton(children0)
        const spacing = is_boolean(spacing0) ? (spacing0 ? 0.25 : 0) : spacing0

        // HStack centers arbitrary embedded elements in the line box, while
        // an element with em metrics is aligned to the surrounding text by them
        const [ child, aspect ] = 'em' in child0 ?
            place_inline_em(child0 as WithEm, spacing) :
            [ child0.clone({ align: 'left' }), (child0.spec.aspect ?? 1) + spacing ]

        super({ children: [ child ], aspect, ...attr })
        this.args = args
    }
}

//
// text class
//

function ensure_tail(text: string): string {
    return `${text.trimEnd()} `
}

function split_span(child: Span, text: string, font_args: Attrs = {}): Element[] {
    return splitWords(text).map((w: string) =>
        child.clone({ children: [ w ], ...font_args })
    )
}

function compress_spans(children: any[], font_args: Attrs = {}): Element[] {
    return children.flatMap((child: any, i: number) => {
        const last_child = i == children.length - 1

        // convert scalars to strings
        if (is_scalar(child)) child = child.toString()

        // process strings into Span's
        // process Text into Span's
        // process Spans into Span's (with args)
        // process Elements into ElemSpan's
        // Scaled text and spans with em metrics stay inline blocks.
        // every child but the last ends in a space, so a child never needs
        // to start with one (a leading space would double up)
        if (is_string(child)) {
            let text = compress_whitespace(child).trimStart()
            if (!last_child) text = ensure_tail(text)
            if (last_child) text = text.trimEnd()
            return splitWords(text).map((w: string) =>
                new Span({ children: [ w ], ...font_args })
            )
        } else if (child instanceof Text && child.em.scale == 1) {
            const spans = child.spans.flatMap((s: Element, i: number) => {
                if (!(s instanceof Span)) return [ s ]
                let { text } = s
                if (i == 0) text = text.trimStart()
                if (i == child.spans.length - 1) text = text.trimEnd()
                return split_span(s, text, font_args)
            })
            return last_child ? spans : [ ...spans, new Span({ children: [ ' ' ], ...font_args }) ]
        } else if (child instanceof Span && !('em' in child)) {
            const spans = split_span(child, child.text.trim(), font_args)
            return last_child ? spans : [ ...spans, new Span({ children: [ ' ' ], ...font_args }) ]
        } else if (child instanceof ElemSpan) {
            return child.clone({ spacing: !last_child })
        } else {
            return [ new ElemSpan({ children: [ child ], spacing: !last_child, env: font_args.env }) ]
        }
    })
}

function trim_line_end(child: Element): Element | null {
    if (child instanceof Span) {
        const text = child.text.trimEnd()
        return text.length > 0 ? child.clone({ children: [ text ] }) : null
    }
    if (child instanceof ElemSpan) {
        return child.clone({ spacing: false })
    }
    return child
}

function normalize_line(children: Element[]): Element[] {
    for (let i = children.length - 1; i >= 0; i--) {
        const child = trim_line_end(children[i])
        if (child == null) continue
        return [ ...children.slice(0, i), child ]
    }
    return []
}

//
// em metrics of text
//

// a text block's anchor is the math axis of its first line: the line box is
// 1em tall with the baseline at 1 + vtext, and the axis maxis above that
const TEXT_ANCHOR = INLINE_MATH_AXIS

// the two sizes of a text element: `width` is its width in its own em (where
// its lines break) and `scale` its own em over the parent's, so its box is
// reported `width * scale` wide. a container that stretches a child to a slot
// supplies the `scale` that fills it (or the `width` that a given scale needs)

// the box of a block of lines: `width` in its own em (its given width, or a
// single line's advance), the height from the block's aspect, anchored on the
// first line's axis, stated in the parent's em through `scale`
function block_em(width: number, aspect: number | undefined, scale: number, anchor: number = TEXT_ANCHOR): EmSpec {
    const height = (aspect != null && aspect > 0) ? width / aspect : 1
    return make_em(scale_em_spec({ width, height, anchor, scale: 1 }, scale))
}

// an element's own box: its metrics, or a one em box as wide as its aspect
function child_em(elem: Element): EmMetrics {
    return (elem as WithEm).em ?? ensure_em_spec(elem)
}

// the anchor of a child stretched to a slot `width` wide (its box scaled to
// fit), for a container that puts the child at its top
function slot_anchor(child: Element, width: number): number {
    const { width: w, anchor } = child_em(child)
    return w > 0 ? anchor * (width / w) : 0
}

//
// slot layout
//

type Laid = LayoutResult
type LayArgs = { justify?: AlignValue, height?: number, span?: boolean, font_attr?: Attrs, text_attr?: Attrs }

function lay_child(c: Element, width: number | undefined, { justify, height, font_attr = {}, text_attr = {} }: LayArgs = {}): Laid {
    return c.layout({ width, maxHeight: height, attrs: { ...font_attr, ...text_attr, ...(justify != null ? { justify: c.args.justify ?? justify } : {}) } })
}

// a laid child with the top left of its box at (x, y) in a container's em frame
function place_laid({ elem, em }: Laid, x: number, y: number): Element {
    return elem.clone({ rect: em_rect(em, x, y + em.anchor) })
}

function box_aspect(width: number, height: number): number | undefined {
    return (width > 0 && height > 0) ? width / height : undefined
}

// a formula placed in a slot at the text's em, for the containers that
// stretch their children (Bullets): the slot is as tall as the box
function place_em_child(elem: Element, width: number, justify: AlignValue): Element {
    const em = (elem as WithEm).em
    if (em == null || elem.reflow || em.width <= 0 || em.height <= 0 || em.width > width) return elem
    const x0 = align_frac(justify) * (width - em.width)
    const [ xlo, ylo, xhi, yhi ] = em_rect(em, x0, em.anchor)
    const group = new Group({ children: [ elem.clone({ rect: [ xlo, ylo, xhi, yhi ] }) ], coord: [ 0, 0, width, em.height ], aspect: width / em.height, env: elem.env })
    return with_em(group, { width, height: em.height, anchor: em.anchor, scale: 1 })
}

//
// text line and block
//

interface TextLineArgs extends GroupArgs {
    padding?: number
    justify?: AlignValue
    width?: number
}

class TextLine extends Group {
    em: EmSpec

    constructor(args: TextLineArgs = {}) {
        const { children: children0, padding, justify = 'left', width, debug, env, ...attr } = THEME(args, 'TextLine')
        const children = ensure_children(children0)
        const line = new HStack({ children, spacing: padding, align: justify, debug, env })
        super({ children: [ line ], aspect: width ?? line.spec.aspect, env, ...attr })
        this.args = args

        // one line: as wide as its width (or its content), one em tall
        this.em = make_em({ width: width ?? line.spec.aspect ?? 1, height: 1, anchor: TEXT_ANCHOR })
    }
}

interface TextArgs extends StackArgs, EmArgs {
    font_family?: string
    font_weight?: number
    font_style?: string
    width?: number  // wrapping width in em, or minimum width for preserved text
    whitespace?: Whitespace
    tab_size?: number  // tab stops in columns for preserved text
}

// Literal lines are measured as whole runs. Expand tabs before measuring so
// SVG, canvas and PDF all see the same spaces and advances.
function preserve_spans(children: any[], tab_size: number, attr: Attrs): Span[] {
    if (!Number.isInteger(tab_size) || tab_size <= 0) throw new Error('tab_size must be a positive integer')
    const text = children.map(child => check_string([child])).join('').replace(/\r\n?/g, '\n')
    return text.split('\n').map(line => {
        let column = 0
        const expanded = Array.from(line, ch => {
            const size = ch === '\t' ? tab_size - column % tab_size : 1
            column += size
            return ch === '\t' ? ' '.repeat(size) : ch
        }).join('')
        return new Span({ children: [expanded], ...attr, whitespace: 'preserve' })
    })
}

// wrap text or elements to multiple lines with fixed line height
class Text extends VStack {
    get reflow(): boolean { return true }
    layout(offer: LayoutOffer = {}): LayoutResult { return layout_reflow(this, offer) }

    spans: Element[]
    em: EmSpec
    whitespace: Whitespace

    constructor(args: TextArgs = {}) {
        const { children: children0, width, scale = 1, whitespace = 'normal', tab_size = 4, spacing, padding, justify, debug, env, ...attr0 } = THEME(args, 'Text')
        const children = ensure_children(children0)
        const [ spec, attr ] = spec_split(attr0)
        if (!['normal', 'pre', 'preserve'].includes(whitespace)) throw new Error(`Unknown whitespace mode: ${whitespace}`)
        const preserve = whitespace !== 'normal'

        // split into words and elements
        const spans = preserve ? preserve_spans(children, tab_size, { env, ...attr }) : compress_spans(children, { env, ...attr })

        // wrap text to line widths
        const measure = (span: Element) => span.spec.aspect ?? 1
        const rows = preserve ? spans.map(span => (span as Span).text.length ? [span] : []) : wrapWidths(spans, measure, width).rows
        // Every literal line has the same box, including blank lines. Width
        // can add room around the source, but never wraps or squeezes a line.
        const line_width = preserve ? Math.max(width ?? 0, max(spans.map(measure)) ?? 0) || 1 : width

        // construct text lines
        const lines = rows.map(row =>
            new TextLine({ children: preserve ? row : normalize_line(row), padding, justify, width: line_width, debug, env })
        )

        // Line boxes are already one em tall. Pack them at their measured
        // size so short and blank lines retain the same font size.
        super({ children: lines, spacing, env, ...spec })
        this.args = args

        // additional props
        this.spans = spans
        this.whitespace = whitespace
        this.em = block_em(line_width ?? this.spec.aspect ?? 1, this.spec.aspect, scale)
    }
}

class Verbatim extends Text {
    constructor(args: TextArgs = {}) {
        const { justify = 'left', ...attr } = THEME(args, 'Verbatim')
        super({ font_family: mono, whitespace: 'preserve', justify, ...attr })
        // Keep line alignment local even when a parent centers the block.
        this.args = { ...args, justify }
    }
}

//
// text containers
//

// what the text containers share: a width and scale of their own, gaps in em,
// and font and text attributes handed to their text children
interface TextContainerArgs extends StackArgs {
    font_family?: string
    font_weight?: number
    font_style?: string
}

interface TextColArgs extends TextContainerArgs {}

class TextCol extends VStack {
    declare em: EmSpec
    constructor(args: TextColArgs = {}) {
        const { gap = 0.5, justify = 'left', valign = 'top', ...attr } = THEME(args, 'TextCol')
        super({ gap, justify, valign, ...attr })
        this.args = args
    }
}

interface TextRowArgs extends TextContainerArgs {}

class TextRow extends HStack {
    declare em: EmSpec
    constructor(args: TextRowArgs = {}) {
        const { gap = 1, justify = 'left', valign = 'top', ...attr } = THEME(args, 'TextRow')
        super({ gap, justify, valign, ...attr })
        this.args = args
    }
}

interface TextGridArgs extends Omit<TextContainerArgs, 'gap'> {
    cols?: number
    gap?: number | [ number, number ]
    valign?: RowAlign
}

// a grid of text blocks in `cols` equal columns, filled row by row: every
// cell gets the column width, a row is as tall as its tallest cell, and the
// gaps (horizontal and vertical) are in em
class TextGrid extends Group {
    get reflow(): boolean { return true }
    layout(offer: LayoutOffer = {}): LayoutResult { return layout_reflow(this, offer) }

    em: EmSpec

    constructor(args: TextGridArgs = {}) {
        const { children: children0, cols = 2, width, scale = 1, gap = 1, valign = 'top', justify = 'left', env, ...attr0 } = THEME(args, 'TextGrid')
        const [ font_attr0, text_attr, attr1 ] = prefix_split([ 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const [ spec, attr ] = spec_split(attr1)
        const [ hgap, vgap ] = ensure_pair(gap)
        const children = ensure_children(children0)
        const rows: Element[][] = []
        for (let i = 0; i < children.length; i += cols) rows.push(children.slice(i, i + cols))

        // the cell width from the grid's, or the widest cell laid at its own size
        const slot = width != null ? (width - (cols - 1) * hgap) / cols : undefined
        const laid = rows.map(row => row.map(c => lay_child(c, slot, { justify, font_attr, text_attr })))
        const cell = slot ?? max(laid.flat().map(l => l.em.width)) ?? 1
        const grid_width = width ?? cols * cell + (cols - 1) * hgap

        // place the cells row by row
        let y = 0
        const placed: Element[] = []
        let anchor = 0
        laid.forEach((row, r) => {
            if (r > 0) y += vgap
            const ys = row_offsets(row, valign)
            if (r == 0 && row.length > 0) anchor = ys[0] + row[0].em.anchor
            row.forEach((l, i) => {
                const x = i * (cell + hgap) + align_frac(child_align(l)[0] ?? justify) * (cell - l.em.width)
                placed.push(place_laid(l, x, y + ys[i]))
            })
            y += max(row.map((l, i) => ys[i] + l.em.height)) ?? 0
        })
        const height = y

        // pass to Group
        super({ children: placed, coord: [ 0, 0, grid_width, height ], aspect: box_aspect(grid_width, height), env, ...attr, ...spec })
        this.args = args
        this.em = make_em(scale_em_spec({ width: grid_width, height, anchor, scale: 1 }, scale))
    }
}

interface TextFigureArgs extends GroupArgs, EmArgs {
    width?: number
    height?: number
    caption?: string | Element
    gap?: number
    justify?: AlignValue
}

// an element given a size in em, with an optional caption below it: a
// `height` (or `width`) sets its size, and in a column it takes the column's
// width with the element fit inside by its aspect. the caption is a text
// block as wide as the figure (or an element with metrics, a formula say),
// `gap` em below it; `caption-*` arguments go to a text caption
class TextFigure extends Group {
    get reflow(): boolean { return true }
    layout(offer: LayoutOffer = {}): LayoutResult { return layout_reflow(this, offer, true) }

    em: EmSpec

    constructor(args: TextFigureArgs = {}) {
        const { children: children0, width, height, scale = 1, caption, gap = 0.3, justify = 'center', env, ...attr0 } = THEME(args, 'TextFigure')
        const [ caption_attr, attr1 ] = prefix_split([ 'caption' ], attr0)
        const [ spec, attr ] = spec_split(attr1)
        const child = check_singleton(children0)

        // the figure's box: from its width and height, one of them and the
        // element's aspect, or the element's own size
        const child_box = child.spec.aspect == null && (child as WithEm).em != null ? (child as WithEm).em : null
        const aspect = child.spec.aspect ?? (child_box != null ? box_aspect(child_box.width, child_box.height) : undefined)
        const [ fig_width, fig_height ] =
            (width != null && height != null) ? [ width, height ] :
            height != null ? [ aspect != null ? height * aspect : height, height ] :
            width != null ? [ width, aspect != null ? width / aspect : width ] :
            child_box != null ? [ child_box.width, child_box.height ] :
            [ aspect ?? 1, 1 ]

        // the element fit in the box by its aspect, placed by justify
        const fit_width = aspect != null ? Math.min(fig_width, fig_height * aspect) : fig_width
        const fit_height = aspect != null ? fit_width / aspect : fig_height
        const x0 = align_frac(justify) * (fig_width - fit_width)
        const y0 = 0.5 * (fig_height - fit_height)
        const figure = child.clone({ rect: [ x0, y0, x0 + fit_width, y0 + fit_height ] })

        // the caption under it
        let total_height = fig_height
        let placed_caption: Element | null = null
        if (caption != null) {
            const elem = is_element(caption) ? caption : new Text({ children: [ caption ] as any, env, ...caption_attr })
            const laid = lay_child(elem, fig_width, { justify })
            const x = align_frac(justify) * (fig_width - laid.em.width)
            placed_caption = place_laid(laid, x, fig_height + gap)
            total_height = fig_height + gap + laid.em.height
        }

        // pass to Group
        super({ children: [ figure, placed_caption ], coord: [ 0, 0, fig_width, total_height ], aspect: box_aspect(fig_width, total_height), env, ...attr, ...spec })
        this.args = args
        this.em = make_em(scale_em_spec({ width: fig_width, height: total_height, anchor: 0.5 * fig_height, scale: 1 }, scale))
    }
}

// Text conveniences; all framing and layout live in Box/Frame.
interface TextBoxArgs extends Omit<BoxArgs, 'aspect' | 'children'> {
    children?: any[]
    aspect?: number | boolean | 'auto'
}
interface TextFrameArgs extends TextBoxArgs {}

class TextBox extends Box {
    constructor(args: TextBoxArgs = {}) {
        const { children: children0, padding = 0.4, margin, aspect, justify = 'left', env, ...attr } = THEME(args, 'TextBox')
        const text = ensure_children(children0)

        // wrap children in a Text element
        const [font_attr, text_attr] = prefix_split(['font', 'text'], attr)
        const children = [new Text({ children: text, env, ...prefix_join('font', font_attr), ...text_attr, justify })]

        // pass to Box
        super({
            children,
            padding: padding === true ? 0.4 : padding,
            margin: margin === true ? 0.4 : margin,
            aspect: aspect === true ? 1 : aspect === false ? undefined : aspect,
            justify, env, ...attr,
        })
        this.args = args
    }
}

class TextFrame extends TextBox {
    constructor(args: TextFrameArgs = {}) {
        const { border = 1, ...attr } = THEME(args, 'TextFrame')
        super({ border, ...attr })
        this.args = args
    }
}

//
// bullet list
//

interface BulletsArgs extends StackArgs, EmArgs {
    width?: number
    marker?: string | Element
    indent?: number
    gap?: number
    font_family?: string
    font_weight?: number
    font_style?: string
}

// the width an item is laid out at in a list body `width` wide: its own em is
// `scale` times the list's, if it says so
function item_width(child: Element, width: number): number {
    const { scale } = child.args ?? {}
    return scale != null ? width / scale : width
}

// a bulleted list: each item is a Text wrapped to the body width with a marker
// in the indent, level with its first line. nested Bullets are indented without
// a marker. widths are in em so the text size matches surrounding text with the
// same width; the gap between items is also in em
class Bullets extends VStack {
    get reflow(): boolean { return true }
    layout(offer: LayoutOffer = {}): LayoutResult { return layout_reflow(this, offer) }

    em: EmSpec

    constructor(args: BulletsArgs = {}) {
        const { children: children0, width = 25, scale = 1, marker: marker0 = '•', indent = 0.75, gap = 0.5, spacing: spacing0, justify = 'left', env, ...attr0 } = THEME(args, 'Bullets')
        const [ font_attr0, text_attr, attr ] = prefix_split([ 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const children: any[] = ensure_children(children0)

        // the body is narrower than the list by the indent
        const width_body = width - indent
        if (width_body <= 0) throw new Error(`Bullets indent (${indent}) must be less than width (${width})`)

        // the indent is a fixed fraction of each row, so it never sets the row
        // height. the marker sits in a one-line box (indent em by one em) at
        // the top of the indent: level with the first line of the body, or
        // shrunk to the row when the body is shorter than a line. a body with
        // metrics whose first line's axis is not the list's (a scaled item)
        // has the marker moved to meet it
        const cell = { width: indent }
        const marker: Element = is_element(marker0) ? marker0 : new Text({ children: [ marker0 ] as any, align: ['left', 'center'], env, ...font_attr })
        const mark0 = new Group({ children: [ marker ], aspect: indent, align: [ 'center', 'top' ], env, ...cell })
        const make_mark = (body: Element): Element => {
            const aspect_body = body.spec.aspect
            const height = (aspect_body != null && aspect_body > 0) ? width_body / aspect_body : null
            const dy = (body as WithEm).em != null ? slot_anchor(body, width_body) - TEXT_ANCHOR : 0
            if (height == null || height < 1 || dy == 0) return mark0
            const shifted = marker.clone({ rect: [ 0, dy / height, 1, (dy + 1) / height ], align: [ 'center', 'top' ] })
            return new Group({ children: [ shifted ], aspect: indent / height, env, ...cell })
        }

        // build item rows
        const bodies: Element[] = []
        const rows = children.map((child: any) => {
            // sublists are indented but get no marker
            if (child instanceof Bullets) {
                const sub = child.clone({ width: item_width(child, width_body), justify, ...font_attr, ...text_attr })
                bodies.push(sub)
                return new HStack({ children: [ new Spacer({ env, ...cell }), sub ], env })
            }

            // wrap text items to the body width; a formula is placed at the
            // text's em, and any other element spans the body as it is
            const body: Element = child instanceof Text ? child.clone({ width: item_width(child, width_body), justify, ...font_attr, ...text_attr }) : place_em_child(child, width_body, justify)
            bodies.push(body)
            return new HStack({ children: [ make_mark(body), body ], env })
        })

        // convert the gap in em into a stack spacing fraction
        const heights = rows.map(r => r.spec.aspect != null ? width / r.spec.aspect : 0)
        const content = sum(heights)
        const gaps = gap * Math.max(rows.length - 1, 0)
        const spacing = spacing0 ?? (content + gaps > 0 ? gaps / (content + gaps) : 0)

        // pass to VStack
        super({ children: rows, spacing, justify, env, ...attr })
        this.args = args

        // the list is `width` wide; the first item's body sits at the top of
        // its row, so its anchor is the list's
        const anchor = bodies.length > 0 ? slot_anchor(bodies[0], width_body) : 0
        this.em = block_em(width, this.spec.aspect, scale, anchor)
    }
}

//
// text styles
//

class Bold extends Text {
    constructor(args: TextArgs = {}) {
        const attr = THEME(args, 'Bold')
        super({ font_weight: bold, ...attr })
    }
}

class Italic extends Text {
    constructor(args: TextArgs = {}) {
        const attr = THEME(args, 'Italic')
        super({ font_style: 'italic', ...attr })
    }
}

//
// exports
//

export { Span, ElemSpan, TextLine, Text, Verbatim, TextCol, TextRow, TextGrid, TextFigure, TextBox, TextFrame, Bullets, Bold, Italic, lay_child, place_laid }
export type { SpanArgs, ElemSpanArgs, TextLineArgs, TextArgs, TextColArgs, TextRowArgs, TextGridArgs, TextFigureArgs, TextBoxArgs, TextFrameArgs, BulletsArgs, RowAlign, Laid }
