/// <reference path="../types/linebreak.d.ts" />
import LineBreaker from 'linebreak'
import { DEFAULTS } from '../engine/defaults'
import { draw_path, draw_text } from '../engine/drawing'
import type { Drawing } from '../engine/drawing'
import { Element } from '../engine/element'
import type { Child, ElementProps } from '../engine/element'
import { MissingGlyphError, graphemes } from '../engine/fonts'
import type { FontProvider, GlyphShape, MeasuredFont } from '../engine/fonts'
import { make_fragment, place_fragment } from '../engine/fragment'
import type { Fragment } from '../engine/fragment'
import { make_point, make_size, transform_rect } from '../engine/geometry'
import { finish_size, make_request } from '../engine/layout'
import { definite_reference, resolve_alignment } from '../lib/composition'
import type { AlignmentValue } from '../lib/composition'
import type { LayoutQuery } from '../engine/pass'
import { transform_path } from '../engine/path'
import { resolve_style } from '../engine/style'
import type { Style, StyleSpec } from '../engine/style'
import { make_measure, resolve_line_height } from '../engine/units'
import type { Length, NormalizedLength, LengthContext } from '../engine/units'

type TextProps = ElementProps & Readonly<{
  text?: string
  wrap?: boolean
  whitespace?: 'normal' | 'pre'
  tab_size?: number
  justify?: Exclude<AlignmentValue, 'stretch' | 'fill'>
}>
// Options for generated labels/captions; the owning component supplies content.
type TextOptions = Omit<TextProps, 'text' | 'children'>
type SpanProps = StyleSpec & Readonly<{ children?: Child }>
type Run = { text: string; style: Style; element?: Element; index?: number }
type Metrics = Readonly<{ font: MeasuredFont; above: number; below: number }>
type GlyphPart = Readonly<{ shape: GlyphShape; style: Style; width: number }>
type SourcePart = GlyphPart | Readonly<{ element: Element; style: Style; index: number }>
type Part = (GlyphPart | Readonly<{ fragment: Fragment; baseline: number }>) & Readonly<{ x: number }>
type Token<Content = SourcePart> = Readonly<{
  parts: readonly Content[]; gap: number; hard: boolean
  above: number; below: number
}>
type PreparedText = Readonly<{
  runs: readonly Run[]; tokens: readonly Token[]; above: number; below: number
}>
type MeasuredText = Readonly<{ text: string; tokens: readonly (Token<Part> & { width: number })[]; above: number; below: number }>
type Line = { parts: Part[]; width: number; above: number; below: number }

function viewport_length(length?: Length | NormalizedLength): boolean {
  const unit = typeof length === 'string' ? length.trim().slice(-2)
    : typeof length === 'object' ? length.unit : undefined
  return unit === 'vw' || unit === 'vh'
}

// Keep ordinary glyph preparation reusable when only the canvas changes. Inline
// elements are measured later; only Span typography affects prepared prose.
function viewport_spans(child: Child): boolean {
  if (Array.isArray(child)) return child.some(viewport_spans)
  return child instanceof Span && (viewport_length(child.props.font_size)
    || viewport_length(child.props.line_height) || viewport_spans(child.props.children))
}

// Merge equivalent adjacent styles so a redundant Span does not disrupt kerning.
function append_run(runs: Run[], text: string, style: Style): void {
  if (!text) return
  const last = runs.at(-1)
  if (last && !last.element && (last.style === style || JSON.stringify(last.style) === JSON.stringify(style))) {
    last.text += text
  } else runs.push({ text, style })
}

// Inline spans are source runs, not independently measured layout children.
function collect_runs(child: Child, style: Style, measure: LengthContext, runs: Run[]): void {
  const { path } = measure
  if (child == null || typeof child === 'boolean') return
  if (Array.isArray(child)) {
    child.forEach((item, index) => collect_runs(item, style, make_measure(measure, { path: `${path}[${index}]` }), runs))
  } else if (typeof child === 'string' || typeof child === 'number') {
    append_run(runs, String(child), style)
  } else if (child instanceof Span) {
    const nested = make_measure(measure, { path: `${path}/Span` })
    const child_style = resolve_style(child.props, style, nested)
    collect_runs(child.props.children, child_style, make_measure(nested, { font_size: child_style.font_size }), runs)
  } else if (child instanceof Element) {
    // Unicode's object replacement character participates in line breaking but
    // is never shaped. Punctuation and nonbreaking spaces keep their semantics.
    runs.push({ text: '\ufffc', style, element: child, index: runs.length })
  } else throw new TypeError(`${path}: Expected text or an inline element`)
}

// Normalize across span boundaries. Normal mode collapses horizontal whitespace
// and trims hard-line edges; both modes retain explicit newlines. Pre mode expands
// tabs to column stops. Nonbreaking spaces are ordinary glyphs, never trimmed.
function normalize_runs(runs: Run[], pre: boolean, tab_size: number): Run[] {
  const result: Run[] = []
  let column = 0, skip_lf = false
  let pending: Style | undefined
  for (const run of runs) {
    const { text, style } = run
    if (run.element) {
      if (pending) { append_run(result, ' ', pending); column++; pending = undefined }
      result.push(run)
      column++; skip_lf = false
      continue
    }
    for (let char of text) {
      if (char === '\n' && skip_lf) { skip_lf = false; continue; }
      skip_lf = char === '\r'
      if (/[\r\v\f\u0085\u2028\u2029]/.test(char)) char = '\n'
      if (char === '\n') {
        append_run(result, char, style)
        pending = undefined; column = 0
      } else if (!pre && (char === ' ' || char === '\t')) {
        if (column) pending = pending ?? style
      } else {
        if (pending) { append_run(result, ' ', pending); column++; pending = undefined; }
        const value = char === '\t' ? ' '.repeat(tab_size - column % tab_size) : char
        append_run(result, value, style)
        column += char === '\u200b' ? 0 : char === '\t' ? value.length : 1
      }
    }
  }
  return result
}

// Leading changes the line box, not the glyphs. A tight line height can put ink
// above/below that box; mixed runs share a baseline and contribute both extents.
function font_metrics(style: Style, fonts: FontProvider, measure: LengthContext): Metrics {
  const font = fonts.resolve(style.font_family, style.font_weight, style.font_style)
  const ascent = font.ascent * style.font_size
  const descent = font.descent * style.font_size
  const height = resolve_line_height(style.line_height, make_measure(measure, { font_size: style.font_size }))
  const above = (height + ascent - descent) / 2
  return { font, above, below: height - above }
}

// The requested face shapes whatever it covers, keeping its kerning. Only after
// a missing glyph do whole grapheme clusters move to a registered fallback face,
// so an emoji sequence never splits. Uncovered text still reports the requested face.
function shape_run(value: string, font: MeasuredFont, style: Style, fonts: FontProvider): GlyphShape[] {
  try { return [font.shape(value)] } catch (error) {
    if (!(error instanceof MissingGlyphError) || !fonts.fallback) throw error
  }
  const pieces: { text: string; font: MeasuredFont }[] = []
  for (const cluster of graphemes(value)) {
    const chosen = font.has_glyphs(cluster) ? font
      : fonts.fallback(cluster, style.font_weight, style.font_style) ?? font
    const last = pieces.at(-1)
    if (last?.font === chosen) last.text += cluster
    else pieces.push({ text: cluster, font: chosen })
  }
  return pieces.map(piece => piece.font.shape(piece.text))
}

// Break the entire logical string before intersecting it with style runs. Span
// boundaries therefore never introduce word breaks. Each legal break unit is
// measured once; subsequent offers only pack these prepared advances into lines.
function prepare_text(props: TextProps, query: LayoutQuery): PreparedText {
  const { whitespace = 'normal', tab_size = DEFAULTS.tab_size } = props
  if (!['normal', 'pre'].includes(whitespace)) throw new TypeError('Unknown whitespace mode')
  if (!Number.isInteger(tab_size) || tab_size <= 0) throw new RangeError('tab_size must be positive')
  if (props.text !== undefined && props.children !== undefined) {
    throw new TypeError('Text accepts text or children, not both')
  }
  const raw: Run[] = []
  collect_runs(props.text ?? props.children, query.style, query.measure, raw)
  const runs = normalize_runs(raw, whitespace === 'pre', tab_size)
  const text = runs.map(run => run.text).join('')
  if (!text) return { runs, tokens: [], above: 0, below: 0 }
  const fonts = query.resource<FontProvider>('fonts')
  const metrics = new Map<Style, Metrics>()
  const get_metrics = (style: Style) => {
    if (!metrics.has(style)) metrics.set(style, font_metrics(style, fonts, query.measure))
    return metrics.get(style)!
  }
  const strut = get_metrics(query.style)

  let offset = 0
  const spans = runs.map(run => {
    const start = offset
    offset += run.text.length
    return { ...run, start, end: offset }
  })
  const breaker = new LineBreaker(text)
  const tokens: Token[] = []
  let start = 0, run_index = 0
  for (let next = breaker.nextBreak(); next; next = breaker.nextBreak()) {
    const end = next.position
    const hard = text[end - 1] === '\n'
    const limit = hard ? end - 1 : end
    const content = text.slice(start, limit)
    const core = whitespace === 'normal' ? content.replace(/ +$/, '') : content
    const boundary = start + core.length
    const parts: SourcePart[] = []
    let gap = 0, above = strut.above, below = strut.below

    // Preserve an inline run's own font metrics, even for whitespace or a newline.
    while (run_index < spans.length && spans[run_index].end <= start) run_index++
    for (let index = run_index; index < spans.length && spans[index].start < end; index++) {
      const run = spans[index]
      const metrics = get_metrics(run.style)
      above = Math.max(above, metrics.above); below = Math.max(below, metrics.below)
      if (run.element) {
        parts.push({ element: run.element, style: run.style, index: run.index! })
        continue
      }
      const from = Math.max(start, run.start)
      const to = Math.min(boundary, run.end)
      const value = text.slice(from, Math.max(from, to)).replace(/\u200b/g, '')
      for (const shape of value ? shape_run(value, metrics.font, run.style, fonts) : []) {
        parts.push({ shape, style: run.style, width: shape.advance * run.style.font_size })
      }
      const space = text.slice(Math.max(from, boundary), Math.min(limit, run.end))
      if (space) gap += metrics.font.shape(space).advance * run.style.font_size
    }
    tokens.push({ parts, gap, hard, above, below })
    start = end
  }
  return { runs, tokens, above: strut.above, below: strut.below }
}

// Element sizes may depend on an established reference, so they belong to
// layout, outside offer-independent preparation. The pass still shares their
// source and shaped content across widths and repeated occurrences.
function measure_text(prepared: PreparedText, query: LayoutQuery): MeasuredText {
  const reference = definite_reference(query.request, query.sizing)
  const labels = new Map<number, string>()
  const tokens = prepared.tokens.map(token => {
    let width = 0, above = token.above, below = token.below
    const parts = token.parts.map((part): Part => {
      const x = width
      if ('shape' in part) { width += part.width; return { ...part, x } }
      const fragment = query.child(part.element, make_request(), reference, part.index,
        { style: part.style, coordinates: null })
      const baseline = fragment.guides.baseline ?? fragment.size.height
      width += fragment.math ? fragment.math.advance + fragment.math.italic : fragment.size.width
      above = Math.max(above, baseline)
      below = Math.max(below, fragment.size.height - baseline)
      labels.set(part.index, fragment.label ?? '\ufffc')
      return { fragment, baseline, x }
    })
    return { ...token, parts, width, above, below }
  })
  const text = prepared.runs.map(run => run.element ? labels.get(run.index!) : run.text).join('')
  return { text, tokens, above: prepared.above, below: prepared.below }
}

// Greedy word wrapping accepts an oversized first word, reporting overflow.
// Track the last content edge separately from pending space to avoid cancellation
// at exact break widths. A final explicit newline contributes a final blank line.
function flow_lines(prepared: MeasuredText, budget: number): Line[] {
  const { tokens, above, below } = prepared
  if (!tokens.length) return []
  const lines: Line[] = []
  let line: Line = { parts: [], width: 0, above, below }
  let cursor = 0, occupied = false
  const finish = () => {
    lines.push(line)
    line = { parts: [], width: 0, above, below }
    cursor = 0; occupied = false
  }
  for (const token of tokens) {
    if (occupied && cursor + token.width > budget) finish()
    line.parts.push(...token.parts.map(part => ({ ...part, x: cursor + part.x })))
    line.width = cursor + token.width
    line.above = Math.max(line.above, token.above)
    line.below = Math.max(line.below, token.below)
    cursor = line.width + token.gap
    occupied = true
    if (token.hard) finish()
  }
  if (occupied || tokens.at(-1)!.hard) finish()
  return lines
}

// Lines are result fragments, never reconstructed elements. Their drawing paths
// use fixed font pixels, with real ink independent of the allocated line boxes.
function text_layout(props: TextProps, query: LayoutQuery) {
  const { justify = 'start', wrap = true } = props
  if (typeof justify !== 'number' && typeof justify !== 'string') {
    throw new TypeError('Text.justify must be start, center, end, or a fraction')
  }
  const alignment = resolve_alignment(justify, `${query.measure.path}.justify`).x
  if (typeof alignment !== 'number') throw new TypeError('Text.justify must be start, center, end, or a fraction')
  const dependencies = viewport_length(query.style.line_height) || viewport_spans(props.children)
    ? [query.measure.viewport] : []
  const prepared = measure_text(query.prepare('text', () => prepare_text(props, query), dependencies), query)
  const offer = query.request.width
  const budget = wrap && offer.kind !== 'natural' ? offer.value : Infinity
  const lines = flow_lines(prepared, budget)
  const width = Math.max(0, ...lines.map(line => line.width))
  const height = lines.reduce((sum, line) => sum + line.above + line.below, 0)
  const size = finish_size(make_size(width, height), query.request, query.sizing)
  let y = 0
  const children = lines.map(line => {
    const glyph = ({ shape, style }: GlyphPart, x: number): Drawing[] => {
      const scale = style.font_size
      const matrix = [scale, 0, 0, scale, x, line.above] as const
      const paint = { fill: style.color, opacity: style.opacity }
      // A color face has no outline to transform; its clusters stay live text.
      if (shape.live) {
        const font = { family: shape.live.family, size: scale }
        return shape.live.clusters.filter(cluster => cluster.ink).map(cluster => draw_text(
          cluster.text, make_point(x + cluster.x * scale, line.above), cluster.advance * scale,
          font, paint, transform_rect(cluster.ink, make_point(), matrix)))
      }
      const commands = transform_path(shape.commands, matrix)
      const ink = transform_rect(shape.ink, make_point(), matrix)
      return [draw_path(commands, { ...paint, stroke: 'none', stroke_width: 0 }, ink)]
    }
    const height = line.above + line.below
    const inline = line.parts.some(part => 'fragment' in part)
    const draw = inline ? [] : line.parts.flatMap(part => glyph(part as GlyphPart, part.x))
    // Keep source painting order when glyphs and elements overlap. Pure prose
    // retains its compact line drawing, with no additional run fragments.
    const content = inline ? line.parts.map(part => 'fragment' in part
      ? place_fragment(part.fragment, make_point(part.x, line.above - part.baseline))
      : place_fragment(make_fragment({ name: 'Run', size: make_size(part.width, height),
          guides: { baseline: line.above }, draw: glyph(part, 0) }), make_point(part.x, 0))) : []
    const fragment = make_fragment({
      name: 'Line', size: make_size(Math.max(0, line.width), height), guides: { baseline: line.above }, draw, children: content,
    })
    const x = (size.width - line.width) * alignment
    const placement = place_fragment(fragment, make_point(x, y))
    y += height
    return placement
  })
  const first = children[0], last = children.at(-1)
  const guides = first && last ? {
    baseline: first.fragment.guides.baseline,
    last_baseline: last.offset.y + last.fragment.guides.baseline!,
  } : {}
  return make_fragment({ size, guides, label: prepared.text, children })
}

class Text extends Element<TextProps> {
  static layout = text_layout
}

class Span extends Element<SpanProps> {
  static layout = text_layout
}

export { Text, Span }
export type { TextProps, TextOptions, SpanProps }
