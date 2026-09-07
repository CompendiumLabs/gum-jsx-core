// text elements

import type { Attrs, AlignValue, Rect, Limit, Padding, Rounded, Orient } from '../lib/types'
import { resolveEnv } from '../lib/default'
import type { Env } from '../env'
import { THEME } from '../lib/theme'
import { none, bold, mono, vtext, maxis } from '../lib/const'
import { RoundedRect } from './geometry'
import { check_string, is_scalar, is_string, is_boolean, compress_whitespace, rect_box, check_singleton, prefix_split, prefix_join, sum, max, pad_rect, ensure_pair } from '../lib/utils'
import { textMetrics, splitWords } from '../lib/text'
import type { TextMetrics, Whitespace } from '../lib/text'
import { wrapWidths } from '../lib/wrap'
import { make_em, em_bounds, em_hink, em_rect, scale_em_spec } from '../lib/em'
import type { EmArgs, EmSpec, EmMetrics } from '../lib/em'

import { Context, Element, Group, Spacer, Rectangle, spec_split, ensure_children, escape_text, is_element, align_frac } from './core'
import { ensure_em_spec, with_em, place_laid, child_align, row_offsets, box_aspect, layout_em_stack } from './em'
import type { WithEm, RowAlign } from './em'
import type { ElementArgs, GroupArgs, MaybeEm, ReflowKey, LayOffer, Laid } from './core'
import { HStack, VStack } from './layout'
import type { StackArgs } from './layout'

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
        const [ child, aspect ] = (child0 as MaybeEm).em != null ?
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
        } else if (child instanceof Span && (child as MaybeEm).em == null) {
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

// a text element laid out for a slot (see Element.lay): it is rebuilt for
// the slot's width unless it has a width of its own, with the justify and
// the font and text settings handed down. `scale` is its em over the
// parent's, so the slot is laid out at width / scale and the box reported
// still fills it
function lay_width<E extends WithEm>(elem: E, offer: LayOffer): Laid {
    const { width, justify, attr = {} } = offer
    const { width: cwidth, scale: cscale, justify: cjustify } = elem.args ?? {}
    const scaled = (x: number) => cscale != null ? x / cscale : x
    const size = (cwidth == null && width != null) ? { width: scaled(width) } : {}
    const justify_attr = justify != null ? { justify: cjustify ?? justify } : {}
    const out = elem.clone({ ...attr, ...size, ...justify_attr }) as WithEm
    return { elem: out, em: out.em }
}

// a formula placed in a slot at the text's em, for the containers that
// stretch their children (Bullets): the slot is as tall as the box
function place_em_child(elem: Element, width: number, justify: AlignValue): Element {
    const em = (elem as WithEm).em
    if (em == null || elem.reflow.length > 0 || em.width <= 0 || em.height <= 0 || em.width > width) return elem
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

        // pass to VStack
        super({ children: lines, spacing, even: true, env, ...spec })
        this.args = args

        // additional props
        this.spans = spans
        this.whitespace = whitespace
        this.em = block_em(line_width ?? this.spec.aspect ?? 1, this.spec.aspect, scale)
    }

    // a text block re-wraps for the width it is given
    get reflow(): ReflowKey[] {
        return [ 'width' ]
    }

    lay(offer: LayOffer = {}): Laid {
        return lay_width(this, offer)
    }
}

class Verbatim extends Text {
    constructor(args: TextArgs = {}) {
        super({ font_family: mono, whitespace: 'preserve', ...THEME(args, 'Verbatim') })
        this.args = args
    }
}

//
// text containers
//

// what the text containers share: a width and scale of their own, gaps in em,
// and font and text attributes handed to their text children
interface TextContainerArgs extends GroupArgs, EmArgs {
    width?: number
    justify?: AlignValue
    font_family?: string
    font_weight?: number
    font_style?: string
}

interface TextStackArgs extends TextContainerArgs {
    direc?: Orient
    gap?: number
    height?: number
    sizes?: number[]
    valign?: RowAlign
}

// a stack of text blocks in em (see layout_em_stack): the children are laid
// out for their slots in one unit, so text, formulas and figures come out at
// one size, and the stack reports its box in em like any measured element,
// so stacks nest. TextCol and TextRow are its two directions. font and text
// settings are handed to the text children; a child's `scale` sets its size
// relative to the stack's em, which is how headings and captions are made
class TextStack extends Group {
    em: EmSpec

    constructor(args: TextStackArgs = {}) {
        const { children: children0, direc = 'v', width, height, scale = 1, gap = 0.5, sizes, valign = 'top', justify = 'left', env, ...attr0 } = THEME(args, 'TextStack')
        const [ font_attr0, text_attr, attr1 ] = prefix_split([ 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const [ spec, attr ] = spec_split(attr1)
        const children = ensure_children(children0)

        // compute layout
        const { metrics, ...layout } = layout_em_stack(direc, children, { width, height, gap, sizes, justify, valign, attr: { ...font_attr, ...text_attr } })

        // pass to Group
        super({ env, ...layout, ...attr, ...spec })
        this.args = args
        this.em = make_em(scale_em_spec(make_em(metrics), scale))
    }

    // a stack lays itself out for a width and budgets a height
    get reflow(): ReflowKey[] {
        return [ 'width', 'height' ]
    }

    // sized by a height budget when it has none of its own and holds a child that is
    flex_height(): boolean {
        return this.args.height == null && this.children.some(c => c.flex_height())
    }

    // laid out again for the slot: for the width, and with the height when
    // one is handed down and it has none of its own. `scale` is the stack's
    // em over the parent's, so the slot is laid out at width / scale
    lay(offer: LayOffer = {}): Laid {
        const { width, height, justify, attr = {} } = offer
        const { width: cwidth, height: cheight, scale: cscale, justify: cjustify } = this.args
        const scaled = (x: number) => cscale != null ? x / cscale : x
        const size: Attrs = {}
        if (cwidth == null && width != null) size.width = scaled(width)
        if (cheight == null && height != null) size.height = scaled(height)
        const justify_attr = justify != null ? { justify: cjustify ?? justify } : {}
        const elem = this.clone({ ...attr, ...size, ...justify_attr }) as TextStack
        return { elem, em: elem.em }
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
        const { gap = 1, ...attr } = THEME(args, 'TextRow')
        super({ direc: 'h', gap, ...attr })
        this.args = args
    }
}

interface TextGridArgs extends TextContainerArgs {
    cols?: number
    gap?: number | [ number, number ]
    valign?: RowAlign
}

// a grid of text blocks in `cols` equal columns, filled row by row: every
// cell gets the column width, a row is as tall as its tallest cell, and the
// gaps (horizontal and vertical) are in em
class TextGrid extends Group {
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
        const attr_child = { ...font_attr, ...text_attr }
        const laid = rows.map(row => row.map(c => c.lay({ width: slot, justify, attr: attr_child })))
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

    // a grid is laid out again for the width it is given
    get reflow(): ReflowKey[] {
        return [ 'width' ]
    }

    lay(offer: LayOffer = {}): Laid {
        return lay_width(this, offer)
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
            const laid = elem.lay({ width: fig_width, justify })
            const x = align_frac(justify) * (fig_width - laid.em.width)
            placed_caption = place_laid(laid, x, fig_height + gap)
            total_height = fig_height + gap + laid.em.height
        }

        // pass to Group
        super({ children: [ figure, placed_caption ], coord: [ 0, 0, fig_width, total_height ], aspect: box_aspect(fig_width, total_height), env, ...attr, ...spec })
        this.args = args
        this.em = make_em(scale_em_spec({ width: fig_width, height: total_height, anchor: 0.5 * fig_height, scale: 1 }, scale))
    }

    // a figure is sized by the height it is given (its width follows from
    // the element's aspect); one with a size of its own keeps it
    get reflow(): ReflowKey[] {
        return [ 'height' ]
    }

    fixed(): boolean {
        const { width, height } = this.args
        return width != null || height != null
    }

    flex_height(): boolean {
        const { width, height } = this.args
        return width == null && height == null
    }

    // laid out for the slot: a width sets the box's width, and a height
    // (when it has none of its own) its height. sized by the height alone, a
    // caption overshoots the budget by its own height, so that comes off and
    // it is laid out once more; one that comes out wider than the slot takes
    // the slot instead. with `span` the box keeps the slot's width and the
    // element is fit inside it (a column)
    lay(offer: LayOffer = {}): Laid {
        const { width, height, span = false, justify, attr = {} } = offer
        const { width: cwidth, height: cheight, scale: cscale, justify: cjustify } = this.args
        const scaled = (x: number) => cscale != null ? x / cscale : x
        const width_child = cwidth ?? (width != null ? scaled(width) : undefined)
        const height_child = (height != null && cheight == null) ? scaled(height) : undefined
        const by_height = height_child != null && cwidth == null
        const box_attr = (span && width_child != null) ? { width: width_child } : {}
        const size_attr = by_height ? { ...box_attr, height: height_child } : { ...(width_child != null ? { width: width_child } : {}), ...(height_child != null ? { height: height_child } : {}) }
        const justify_attr = justify != null ? { justify: cjustify ?? justify } : {}
        const relay = (size: Attrs): Laid => {
            const elem = this.clone({ ...attr, ...size, ...justify_attr }) as TextFigure
            return { elem, em: elem.em }
        }
        let laid = relay(size_attr)
        if (by_height) {
            const over = laid.em.height - height_child!
            if (over > 0 && height_child! > over) laid = relay({ ...box_attr, height: height_child! - over })
            if (width_child != null && laid.em.width > width_child) laid = relay({ width: width_child })
        }
        return laid
    }
}

interface TextBoxArgs extends Omit<GroupArgs, 'aspect'>, EmArgs {
    padding?: Padding
    margin?: Padding
    border?: number | boolean
    rounded?: Rounded
    fill?: string
    aspect?: number | boolean
    justify?: AlignValue
    width?: number
    font_family?: string
    font_weight?: number
    font_style?: string
}

// a box drawn around text (or around one element with metrics, a formula or
// a column say): `padding` and `margin` are in em, the box is as big as its
// content plus them; `rounded` corners use stroke units. an `aspect` widens
// (or heightens) the box around the content, which is centered in it. a box
// whose text fits on one line tightens to that line, so a badge in a column
// does not span it.
// `border` is a stroke width and `fill` a background; `border-*` and `fill-*`
// reach the frame and background
class TextBox extends Group {
    em: EmSpec

    constructor(args: TextBoxArgs = {}) {
        const { children: children0, padding: padding0 = 0.4, margin: margin0, border, fill, rounded: rounded0, aspect: aspect0, justify = 'left', width, scale = 1, env, ...attr0 } = THEME(args, 'TextBox')
        const [ border_attr, fill_attr, font_attr0, text_attr, attr1 ] = prefix_split([ 'border', 'fill', 'font', 'text' ], attr0)
        const font_attr = prefix_join('font', font_attr0)
        const [ spec, attr ] = spec_split(attr1)
        const children = ensure_children(children0)

        // padding and margin in em; a boolean takes the default
        const [ pl, pt, pr, pb ] = pad_rect(padding0 === true ? 0.4 : padding0 === false ? 0 : padding0)
        const [ ml, mt, mr, mb ] = pad_rect(margin0 === true ? 0.4 : (margin0 == null || margin0 === false) ? 0 : margin0)

        // the content, laid out for the width inside them: one element with
        // metrics is boxed as it is, anything else is set as text
        const inner_width = width != null ? Math.max(width - pl - pr - ml - mr, 0) : undefined
        const only = children.length == 1 ? children[0] : null
        const boxed = only != null && (!(only instanceof Text) || only.whitespace !== 'normal' || only.em.scale != 1) && is_element(only) && ((only as WithEm).em != null || only.reflow.length > 0)
        let inner: Laid
        if (boxed) {
            inner = only!.lay({ width: inner_width, justify, attr: { ...font_attr, ...text_attr } })
        } else {
            const text0 = new Text({ children, justify, width: inner_width, env, ...text_attr, ...font_attr })
            const text = (inner_width != null && text0.children.length == 1) ? new Text({ children, justify, env, ...text_attr, ...font_attr }) : text0
            inner = { elem: text, em: text.em }
        }
        const { width: w, height: h, anchor } = inner.em
        let box_width = w + pl + pr
        let box_height = h + pt + pb

        // an aspect grows the box around the content
        const aspect = aspect0 === true ? 1 : aspect0 === false ? undefined : aspect0
        if (aspect != null) {
            if (box_width / box_height < aspect) box_width = aspect * box_height
            else box_height = box_width / aspect
        }
        const x0 = ml + pl + 0.5 * (box_width - pl - pr - w)
        const y0 = mt + pt + 0.5 * (box_height - pt - pb - h)
        const total_width = box_width + ml + mr
        const total_height = box_height + mt + mb

        // the background and the frame, drawn inside the margin
        const rounded = rounded0 === false ? undefined : rounded0
        const shape_rect: Rect = [ ml, mt, ml + box_width, mt + box_height ]
        const make_shape = (extra: Attrs) => rounded != null
            ? new RoundedRect({ rounded, rect: shape_rect, env, ...extra })
            : new Rectangle({ rect: shape_rect, env, ...extra })
        const background = fill != null ? make_shape({ fill, stroke: none, ...fill_attr }) : null
        const frame = (border != null && border !== false) ? make_shape({ stroke_width: border === true ? 1 : border, fill: none, ...border_attr }) : null
        const content = place_laid(inner, x0, y0)

        // pass to Group
        super({ children: [ background, content, frame ], coord: [ 0, 0, total_width, total_height ], aspect: box_aspect(total_width, total_height), env, ...attr, ...spec })
        this.args = args
        this.em = make_em(scale_em_spec({ width: total_width, height: total_height, anchor: y0 + anchor, scale: 1 }, scale))
    }

    // a box is laid out again for the width it is given
    get reflow(): ReflowKey[] {
        return [ 'width' ]
    }

    lay(offer: LayOffer = {}): Laid {
        return lay_width(this, offer)
    }
}

interface TextFrameArgs extends TextBoxArgs {}

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
        const cell = { stack_size: indent / width }
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

    // a list is laid out again for the width it is given
    get reflow(): ReflowKey[] {
        return [ 'width' ]
    }

    lay(offer: LayOffer = {}): Laid {
        return lay_width(this, offer)
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

export { Span, ElemSpan, TextLine, Text, Verbatim, TextStack, TextCol, TextRow, TextGrid, TextFigure, TextBox, TextFrame, Bullets, Bold, Italic }
export type { SpanArgs, ElemSpanArgs, TextLineArgs, TextArgs, TextStackArgs, TextColArgs, TextRowArgs, TextGridArgs, TextFigureArgs, TextBoxArgs, TextFrameArgs, BulletsArgs }
