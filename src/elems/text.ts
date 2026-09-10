// text elements

import type { Attrs, AlignValue, Rect, Limit } from '../lib/types'
import { resolveEnv } from '../lib/default'
import type { Env } from '../env'
import { THEME } from '../lib/theme'
import { TEXT_AXIS, MATH_AXIS, none, bold, mono } from '../lib/const'
import { check_string, is_scalar, is_string, is_boolean, compress_whitespace, rect_box, check_singleton, prefix_split, prefix_join, sum, max } from '../lib/utils'
import { text_metrics, split_words } from '../lib/text'
import type { Glyphs, Whitespace } from '../lib/text'
import { wrap_widths } from '../lib/wrap'
import { em_bounds, em_hink, text_em, bounds_em } from '../lib/em'
import type { EmArgs, EmSpec, EmMetrics } from '../lib/em'
import { EPS, point } from '../lib/layout'

import { Context, Element, Group, Spacer, spec_split, ensure_children, escape_text, is_element, align_frac, fit_laid } from './core'
import { place_laid, child_align, row_offsets } from './em'
import type { WithEm, RowAlign } from './em'
import type { ElementArgs, GroupArgs, Bounds, Offer, Laid } from './core'
import { Stack } from './layout'
import type { StackArgs } from './layout'

//
// span class
//

// frame: as the 1em line it sits in, or by its ink
// axis: where the math axis crosses an ink-framed span
type SpanFrame = 'line' | 'ink'
type SpanAxis = 'baseline' | 'center'

interface SpanArgs extends ElementArgs {
    children?: string[]
    color?: string
    stroke?: string
    font_family?: string
    font_weight?: number
    font_style?: string
    whitespace?: Whitespace
    frame?: SpanFrame
    axis?: SpanAxis
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
    glyphs: Glyphs   // the run as drawn: its font size and baseline in the span's frame

    constructor(args: SpanArgs = {}) {
        const { children: children0, color, whitespace = 'normal', stroke = none, frame = 'line', axis = 'baseline', metrics: metrics0, env, ...attr0 } = THEME(args, 'Span')
        const text0 = check_string(children0)
        const [ font_attr0, attr ] = prefix_split([ 'font' ], attr0)
        const font_attr = prefix_join('font', font_attr0)

        // preserve whitespace arguments
        const preserve = whitespace === 'pre' || whitespace === 'preserve'
        const preserve_attr = preserve ? { 'xml:space': 'preserve' } : {}

        // measure the run at a 1em font: its advance, its ink above the
        // baseline (y up) and its italic correction
        const text = preserve ? text0 : compress_whitespace(text0)
        const { advance, ink: [ ymin, ymax ], italic } = text_metrics(text, { ...font_attr, whitespace, env })

        // frame it: the glyphs it draws by (font size and baseline in its
        // frame), what it tells the element, and its layout box if any
        let glyphs: Glyphs
        let metrics: EmMetrics | undefined
        let spec: { coord?: Rect, aspect: number }
        if (frame == 'ink' && ymax > ymin) {
            // by its ink, about the math axis (TeX Rule 13): the ink box is the
            // coordinate frame, so an assigned rect scales the glyph with its box
            const baseline = axis == 'center' ? 0.5 * (ymax + ymin) : MATH_AXIS
            const box: Limit = [ baseline - ymax, baseline - ymin ]  // the ink about the axis, y down
            glyphs = { size: 1, baseline }
            metrics = { ...bounds_em(advance, box), italic, ...metrics0 }
            spec = { coord: [ 0, box[0], 1, box[1] ], aspect: advance / (ymax - ymin) }
        } else {
            // in a 1em line: the font fills the line, or shrinks to fit ink
            // taller than that (set a quarter down instead of on the bottom),
            // and sits TEXT_AXIS up from the bottom. the span is as wide as
            // its advance, with no box of its own (a line places it by its
            // advance) unless it states one, or was to be framed by ink it
            // does not have
            const line_height = Math.max(1, ymax - ymin)
            const size = 1 / line_height
            const top = line_height > 1 ? 0.25 : 1 - ymax
            const baseline = top + ymax * size + TEXT_AXIS
            glyphs = { size, baseline }
            metrics = (frame == 'ink' || metrics0 != null) ? { ...text_em(advance / line_height, glyphs), italic: italic / line_height, ...metrics0 } : undefined
            spec = { aspect: advance / line_height }
        }

        // pass to element; the font is measured by its registry name but named
        // in the output by its css face (family plus weight and style)
        super({ tag: 'text', unary: false, ...spec, metrics, fill: color, stroke, ...font_attr, ...font_css(font_attr, env), ...attr, ...preserve_attr })
        this.args = args

        // additional props
        this.text = text
        this.glyphs = glyphs
    }

    // because text will always be displayed upright,
    // we need to find the ordered bounds of the text
    // and then offset it by the given offset
    props(ctx: Context): Attrs {
        const attr = super.props(ctx)

        // map the font box without the text shift and apply it in pixel space,
        // so it points down on screen whatever the frame's orientation
        const { size, baseline } = this.glyphs
        const font_rect: Rect = [ 0, baseline - size - TEXT_AXIS, 1, baseline - TEXT_AXIS ]
        const rect = ctx.mapRect(font_rect)

        // get position and size
        const [ x, y0, _w, h ] = rect_box(rect, true)
        const y = y0 + (1 + TEXT_AXIS) * h

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
// them; the line box is 1em tall with the text baseline at 1 + TEXT_AXIS, so the
// math axis sits MATH_AXIS above that
const INLINE_MATH_AXIS = 1 + TEXT_AXIS - MATH_AXIS

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
        const [ child, aspect ] = child0.em != null ?
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
    return split_words(text).map((w: string) =>
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
            return split_words(text).map((w: string) =>
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
        } else if (child instanceof Span && child.em == null) {
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
// 1em tall with the baseline at 1 + TEXT_AXIS, and the axis MATH_AXIS above that
const TEXT_ANCHOR = INLINE_MATH_AXIS

// the advance of a span in line units
function span_width(span: Element): number {
    return span.spec.aspect ?? 1
}

// the narrowest width that wraps the spans into at most `lines` lines: well
// defined because greedy line count never increases with width
function narrowest_width(spans: Element[], lines: number): number {
    const widths = spans.map(span_width)
    const minc = max(widths) ?? 0
    const maxc = sum(widths)
    const count = (w: number) => wrap_widths(spans, span_width, w).rows.length
    const n = Math.max(1, lines)
    if (count(minc) <= n) return minc
    if (count(maxc) > n) return maxc
    let lo = minc, hi = maxc
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        if (count(mid) <= n) hi = mid
        else lo = mid
    }
    return hi
}

//
// text line and block
//

interface TextLineArgs extends GroupArgs {
    justify?: AlignValue
    width?: number
}

// one line of spans, packed left to right in a box `width` wide (or as wide
// as they come to) and one em tall, placed along it by justify
class TextLine extends Group {
    declare em: EmSpec

    constructor(args: TextLineArgs = {}) {
        const { children: children0, justify = 'left', width, debug, env, ...attr } = THEME(args, 'TextLine')
        const spans = ensure_children(children0)
        const widths = spans.map(span_width)
        const total = sum(widths)
        const w = width ?? total
        let x = align_frac(justify) * (w - total)
        const placed = spans.map((s, i) => {
            const rect: Rect = [ x, 0, x + widths[i], 1 ]
            x += widths[i]
            return s.clone({ rect })
        })
        // one line: as wide as its width (or its content), one em tall
        const metrics: EmMetrics = { width: w, height: 1, anchor: TEXT_ANCHOR }
        super({ children: placed, metrics, upright: true, debug, env, ...attr })
        this.args = args
    }
}

interface TextArgs extends GroupArgs, EmArgs {
    font_family?: string
    font_weight?: number
    font_style?: string
    width?: number       // the width the text wraps at, in its em: a box that wide, or for fit text the block it scales (minimum width for preserved text)
    height?: number
    fit?: boolean        // scaled to its slot like a figure, rather than set at its em
    gap?: number         // extra line spacing, in em: lines are 1 + gap apart
    justify?: AlignValue
    whitespace?: Whitespace
    tab_size?: number    // tab stops in columns for preserved text
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

// a block of text: words (and inline elements) wrapped into lines one em tall,
// in the text's own em. as content it wraps to the width it is offered (or
// the narrowest width that fits an offered height), and its bounds run from
// its longest word to its one-line length; a `width` of its own is the width
// it wraps at and the width of its box. with `fit` it is set once (one line,
// or wrapped at its `width`) and the block scales to its slot, the way a
// title in a figure does. `scale` is its em over the surrounding em
class Text extends Group {
    spans: Element[]
    declare em: EmSpec
    whitespace: Whitespace
    fit: boolean
    gap: number

    constructor(args: TextArgs = {}) {
        const { children: children0, width, fit = false, scale = 1, whitespace = 'normal', tab_size = 4, gap = 0, justify = 'left', debug, offer, env, ...attr0 } = THEME(args, 'Text')
        const children = ensure_children(children0)
        const [ spec, attr ] = spec_split(attr0)
        if (!['normal', 'pre', 'preserve'].includes(whitespace)) throw new Error(`Unknown whitespace mode: ${whitespace}`)
        const preserve = whitespace !== 'normal'

        // split into words and elements
        const spans = preserve ? preserve_spans(children, tab_size, { env, ...attr }) : compress_spans(children, { env, ...attr })

        // the width to wrap at, in the text's em: its own; else the offer's
        // width, or the narrowest that fits the offer's height. fit text
        // wraps only at its own width
        let wrap_at: number | undefined = width
        if (wrap_at == null && !fit && !preserve && offer != null) {
            if (offer.width != null) wrap_at = offer.width / scale
            else if (offer.height != null) wrap_at = narrowest_width(spans, Math.floor((offer.height / scale + gap) / (1 + gap) + 1e-9))
        }

        // wrap text to lines: literal lines are kept whole
        const rows = preserve ? spans.map(span => (span as Span).text.length ? [ span ] : []) : wrap_widths(spans, span_width, wrap_at).rows.map(normalize_line)
        const widths = rows.map(row => sum(row.map(span_width)))

        // the block's width: its own; a preserved block's widest line; else
        // the width it wrapped at when it wrapped, or its one line. Every
        // literal line has the same box, including blank lines
        const line_width = preserve
            ? (Math.max(width ?? 0, max(widths) ?? 0) || 1)
            : width ?? ((rows.length > 1 && wrap_at != null) ? Math.max(wrap_at, max(widths) ?? 0) : (max(widths) ?? 0))

        // construct text lines and place them down the block, `gap` em
        // apart: n lines are n + (n - 1) gap em tall
        const lines = rows.map(row => new TextLine({ children: row, justify, width: line_width, debug, env }))
        const n = lines.length
        const pitch = 1 + gap
        const total = n > 0 ? n + (n - 1) * gap : 0
        const placed = lines.map((l, i) => l.clone({ rect: [ 0, i * pitch, line_width, i * pitch + 1 ] }))

        // pass to Group; content text keeps its width as a size of its own
        const metrics: EmMetrics = { width: line_width, height: total, anchor: TEXT_ANCHOR }
        super({ children: placed, metrics, scale, upright: true, env, ...spec, fit, width: fit ? undefined : width })
        this.args = args

        // additional props
        this.spans = spans
        this.whitespace = whitespace
        this.fit = fit
        this.gap = gap
    }

    // as content: from its longest word to its one line wide, one line to
    // its narrowest wrap tall; preserved text is its block; fit text is a
    // ray at the block's aspect
    natural(): Bounds {
        const s = this.em.scale
        if (this.whitespace !== 'normal') return { width: point(this.em.width), height: point(this.em.height), stretch: [ true, false ] }
        const widths = this.spans.map(span_width)
        const minc = max(widths) ?? 0
        const maxc = sum(widths)
        const most = wrap_widths(this.spans, span_width, minc).rows.length
        const total = (k: number) => k + (k - 1) * this.gap
        return { width: [ minc * s, maxc * s ], height: [ total(1) * s, total(most) * s ], stretch: [ true, false ] }
    }

    // laid out for the slot (fit text is scaled into it by the base): set
    // again for the width (or height) unless it has a width of its own, with
    // the text alignment and settings handed down
    place(offer: Offer = {}): Laid {
        const { width, height, justify, attr = {} } = offer
        const { width: cwidth, justify: cjustify } = this.args
        const size = cwidth != null ? {} : (offer.fill && width != null) ? { width: width / this.em.scale } : { offer: { width, height } }
        const justify_attr = (justify != null && cjustify == null) ? { justify } : {}
        const elem = this.clone({ ...attr, ...size, ...justify_attr }) as Text
        if (!offer.fit) return { elem, em: elem.em }

        // to be fit into the slot (a box's content): text that does not fit
        // it at its em is scaled to it, as the wrapped block or as one line,
        // whichever comes out larger
        const over = (em: EmSpec) => (width != null && em.width > width + EPS) || (height != null && em.height > height + EPS)
        if (!over(elem.em)) return { elem, em: elem.em }
        const line = cwidth != null ? elem : this.args.offer == null ? this : this.clone({ ...attr, ...justify_attr, offer: undefined }) as Text
        const scale = (em: EmSpec) => Math.min(width != null ? width / em.width : Infinity, height != null ? height / em.height : Infinity)
        const best = scale(line.em) > scale(elem.em) ? line : elem
        return fit_laid(best, best.em, { width, height })
    }
}

class Verbatim extends Text {
    constructor(args: TextArgs = {}) {
        super({ font_family: mono, whitespace: 'preserve', ...THEME(args, 'Verbatim') })
        this.args = args
    }
}

//
// text stacks
//

interface TextStackArgs extends StackArgs {}

// a stack with text's defaults: a column half a line apart with its children
// flush left, a row one em apart with its children aligned by their tops.
// TextCol and TextRow are its two directions
class TextStack extends Stack {
    constructor(args: TextStackArgs = {}) {
        const { direc = 'v', gap = direc == 'v' ? 0.5 : 1, justify = 'left', valign = 'top', ...attr } = THEME(args, 'TextStack')
        super({ direc, gap, justify, valign, ...attr })
        this.args = args
    }
}

interface TextColArgs extends Omit<TextStackArgs, 'direc'> {}

// a column of text blocks, `gap` em apart (half a line by default)
class TextCol extends TextStack {
    constructor(args: TextColArgs = {}) {
        const attr = THEME(args, 'TextCol')
        super({ direc: 'v', ...attr })
        this.args = args
    }
}

interface TextRowArgs extends Omit<TextStackArgs, 'direc'> {}

// a row of text blocks side by side, `gap` em apart (one em by default)
class TextRow extends TextStack {
    constructor(args: TextRowArgs = {}) {
        const attr = THEME(args, 'TextRow')
        super({ direc: 'h', ...attr })
        this.args = args
    }
}

interface TextGridArgs extends GroupArgs, EmArgs {
    cols?: number
    width?: number
    gap?: number | [ number, number ]
    valign?: RowAlign
    justify?: AlignValue
    font_family?: string
    font_weight?: number
    font_style?: string
}

// a grid of text blocks in `cols` equal columns, filled row by row: every
// cell gets the column width, a row is as tall as its tallest cell, and the
// gaps (horizontal and vertical) are in em
class TextGrid extends Group {
    declare em: EmSpec
    cells: Element[]
    cols: number
    gaps: [ number, number ]

    constructor(args: TextGridArgs = {}) {
        const { children: children0, cols = 2, width: width0, scale = 1, gap = 1, valign = 'top', justify = 'left', offer, env, ...attr0 } = THEME(args, 'TextGrid')
        const [ font_attr0, text_attr, attr1 ] = prefix_split([ 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const [ spec, attr ] = spec_split(attr1)
        const [ hgap, vgap ] = is_scalar(gap) ? [ gap, gap ] as [ number, number ] : gap as [ number, number ]
        const children = ensure_children(children0)
        const rows: Element[][] = []
        for (let i = 0; i < children.length; i += cols) rows.push(children.slice(i, i + cols))

        // the cell width from the grid's (its own, or the offer's), or the
        // widest cell laid at its own size; a cell is a slot, so a cell that
        // can span it (a box, a text block) is given it as a width of its own
        const width = width0 ?? (offer?.width != null ? offer.width / scale : undefined)
        const slot = width != null ? (width - (cols - 1) * hgap) / cols : undefined
        const attr_child = { ...font_attr, ...text_attr }
        const sized = (c: Element): Element => slot != null && c.spec.width == null ? c.clone({ width: slot / c.scale }) : c
        const laid = rows.map(row => row.map(c => sized(c).lay({ width: slot, justify, attr: attr_child })))
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
        const metrics: EmMetrics = { width: grid_width, height, anchor }
        super({ children: placed, metrics, scale, upright: true, env, ...attr, ...spec, width: width0 })
        this.args = args
        this.cells = children
        this.cols = cols
        this.gaps = [ hgap, vgap ]
    }

    // the columns' worth of the widest cell's range, and the rows' heights
    natural(): Bounds {
        const s = this.em.scale
        const { cols, cells, gaps: [ hgap, vgap ] } = this
        const B = cells.map(c => c.bounds())
        const nrows = Math.ceil(cells.length / cols)
        const wmin = (max(B.map(b => b.width[0])) ?? 0) * cols + (cols - 1) * hgap
        const wmax = (max(B.map(b => b.width[1])) ?? 0) * cols + (cols - 1) * hgap
        const row = (r: number, i: 0 | 1) => max(B.slice(r * cols, (r + 1) * cols).map(b => b.height[i])) ?? 0
        const hmin = sum(Array.from({ length: nrows }, (_, r) => row(r, 0))) + Math.max(nrows - 1, 0) * vgap
        const hmax = sum(Array.from({ length: nrows }, (_, r) => row(r, 1))) + Math.max(nrows - 1, 0) * vgap
        return { width: [ wmin * s, wmax * s ], height: [ hmin * s, hmax * s ], stretch: [ true, false ] }
    }

    // laid out again for the width it is given (a filled slot as its own)
    place(offer: Offer = {}): Laid {
        const { width, height, fill, justify, attr = {} } = offer
        const justify_attr = (justify != null && this.args.justify == null) ? { justify } : {}
        const size = (fill && width != null && this.args.width == null) ? { width: width / this.em.scale } : { offer: { width, height } }
        const elem = this.clone({ ...attr, ...justify_attr, ...size }) as TextGrid
        return { elem, em: elem.em }
    }
}

interface TextFigureArgs extends StackArgs {
    caption?: string | Element
}

// an element with an optional caption below it, as a column: a `width` or
// `height` sizes the element (the other side follows from its aspect), and
// without one it spans a column's width or takes the height a budget leaves
// it, the caption keeping its size. the caption is a text block as wide as
// the figure (or an element with metrics, a formula say), `gap` em below it;
// `caption-*` arguments go to a text caption
class TextFigure extends Stack {
    constructor(args: TextFigureArgs = {}) {
        const { children: children0, width, height, caption, gap = 0.3, justify = 'center', align = 'center', env, ...attr0 } = THEME(args, 'TextFigure')
        const [ caption_attr, attr ] = prefix_split([ 'caption' ], attr0)
        const child = check_singleton(children0)

        // the element at its size, and the caption under it
        const figure = (width != null || height != null) ? child.clone({ width, height }) : child
        const cap = caption == null ? null : is_element(caption) ? caption : new Text({ children: [ caption ] as any, env, ...caption_attr })

        // pass to Stack; the figure's justify is its own (a column does not
        // hand it one), and it sits in the middle of a column's slot unless
        // its align says otherwise
        super({ direc: 'v', children: [ figure, cap ], gap, justify, align, anchor: 'first', env, ...attr })
        this.args = { ...args, justify }
    }
}

interface BulletsArgs extends StackArgs {
    marker?: string | Element
    indent?: number
}

// the width an item is laid out at in a list body `width` wide: its own em is
// `scale` times the list's, if it says so
function item_width(child: Element, width: number): number {
    const { scale } = child.args ?? {}
    return scale != null ? width / scale : width
}

// a bulleted list: a column of rows, each a marker in the indent beside its
// item, level with the item's first line (their anchors aligned). a text item
// wraps to the body width; a formula keeps its size; any other element takes
// the body. nested Bullets are indented without a marker. widths are in em
// so the text size matches surrounding text with the same width; the gap
// between items is also in em, and the list wraps to the width it is offered
// when it has none of its own (25 em)
class Bullets extends Stack {
    entries: Element[]
    indent: number
    gap: number

    constructor(args: BulletsArgs = {}) {
        const { children: children0, width: width0, scale = 1, marker: marker0 = '•', indent = 0.75, gap = 0.5, justify = 'left', offer, env, ...attr0 } = THEME(args, 'Bullets')
        const [ font_attr0, text_attr, attr ] = prefix_split([ 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const children: any[] = ensure_children(children0)

        // the body is narrower than the list by the indent
        const width = width0 ?? (offer?.width != null ? offer.width / scale : 25)
        const width_body = width - indent
        if (width_body <= 0) throw new Error(`Bullets indent (${indent}) must be less than width (${width})`)

        // the marker sits in a one-line box as wide as the indent
        const make_mark = (): Element => is_element(marker0)
            ? marker0.clone({ width: indent })
            : new Text({ children: [ marker0 ] as any, width: indent, justify: 'left', env, ...font_attr })

        // build item rows
        const rows = children.map((child: any) => {
            // sublists are indented but get no marker
            if (child instanceof Bullets) {
                const sub = child.clone({ width: item_width(child, width_body), justify, ...font_attr, ...text_attr })
                return new Stack({ direc: 'h', children: [ new Spacer({ width: indent, env }), sub ], valign: 'top', env })
            }

            // text items wrap to the body width; a formula keeps its size and
            // sits on the marker's anchor; anything else takes the body
            const body: Element = child instanceof Text ? child.clone({ width: item_width(child, width_body), justify, ...font_attr, ...text_attr }) : child
            const valign = body.em != null ? 'anchor' : 'top'
            return new Stack({ direc: 'h', children: [ make_mark(), body ], valign, justify: 'left', env })
        })

        // pass to Stack: the list's own width is the one it was given; the
        // default is only what it is laid out at
        super({ direc: 'v', children: rows, gap, width: width0, scale, justify, anchor: 'first', env, ...attr, offer: width0 == null ? { width: width * scale, height: offer?.height, fill: offer?.fill } : undefined })
        this.args = args
        this.entries = children.filter(is_element)
        this.indent = indent
        this.gap = gap
    }

    // the range of the items (which wrap to whatever the list is laid out
    // at), plus the indent; the rows built for one width are not the bounds
    natural(): Bounds {
        const s = this.scale
        const { indent, gap, entries } = this
        const B = entries.map(c => c.bounds())
        const n = entries.length
        const wmin = (max(B.map(b => b.width[0])) ?? 0) + indent
        const wmax = (max(B.map(b => b.width[1])) ?? 0) + indent
        const hmin = sum(B.map(b => b.height[0])) + gap * Math.max(n - 1, 0)
        const hmax = sum(B.map(b => b.height[1])) + gap * Math.max(n - 1, 0)
        return { width: [ wmin * s, wmax * s ], height: [ hmin * s, hmax * s ], stretch: [ true, false ] }
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

export { Span, ElemSpan, TextLine, Text, Verbatim, TextStack, TextCol, TextRow, TextGrid, TextFigure, Bullets, Bold, Italic, TEXT_ANCHOR }
export type { SpanArgs, SpanFrame, SpanAxis, ElemSpanArgs, TextLineArgs, TextArgs, TextStackArgs, TextColArgs, TextRowArgs, TextGridArgs, TextFigureArgs, BulletsArgs }
