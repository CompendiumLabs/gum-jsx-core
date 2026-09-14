/// <reference path="../types/linebreak.d.ts" />
import LineBreaker from 'linebreak';
import { DEFAULTS } from '../engine/defaults';
import { draw_path } from '../engine/drawing';
import { Element } from '../engine/element';
import type { Child, ElementProps } from '../engine/element';
import type { FontProvider, GlyphShape, MeasuredFont } from '../engine/fonts';
import { make_fragment, place_fragment } from '../engine/fragment';
import { make_point, make_size, transform_rect } from '../engine/geometry';
import { finish_size } from '../engine/layout';
import type { LayoutQuery } from '../engine/pass';
import { transform_path } from '../engine/path';
import { resolve_style } from '../engine/style';
import type { Style, StyleSpec } from '../engine/style';
import { resolve_line_height } from '../engine/units';

type TextProps = ElementProps & Readonly<{
  text?: string;
  wrap?: boolean;
  whitespace?: 'normal' | 'pre';
  tab_size?: number;
  text_align?: 'left' | 'center' | 'right';
}>;
// Options for generated labels/captions; the owning component supplies content.
type TextOptions = Omit<TextProps, 'text' | 'children'>;
type SpanProps = StyleSpec & Readonly<{ children?: Child }>;
type Run = { text: string; style: Style };
type Metrics = Readonly<{ font: MeasuredFont; above: number; below: number }>;
type Part = Readonly<{ shape: GlyphShape; style: Style; x: number }>;
type Token = Readonly<{
  parts: readonly Part[]; width: number; gap: number; hard: boolean;
  above: number; below: number;
}>;
type PreparedText = Readonly<{
  text: string; tokens: readonly Token[]; above: number; below: number;
}>;
type Line = { parts: Part[]; width: number; above: number; below: number };

// Merge equivalent adjacent styles so a redundant Span does not disrupt kerning.
function append_run(runs: Run[], text: string, style: Style): void {
  if (!text) return;
  const last = runs.at(-1);
  if (last && (last.style === style || JSON.stringify(last.style) === JSON.stringify(style))) {
    last.text += text;
  } else runs.push({ text, style });
}

// Inline spans are source runs, not independently measured layout children.
function collect_runs(child: Child, style: Style, path: string, runs: Run[]): void {
  if (child == null || typeof child === 'boolean') return;
  if (Array.isArray(child)) {
    child.forEach((item, index) => collect_runs(item, style, `${path}[${index}]`, runs));
  } else if (typeof child === 'string' || typeof child === 'number') {
    append_run(runs, String(child), style);
  } else if (child instanceof Span) {
    const nested = `${path}/Span`;
    collect_runs(child.props.children, resolve_style(child.props, style, nested), nested, runs);
  } else throw new TypeError(`${path}: Text content must be strings, numbers, or Spans`);
}

// Normalize across span boundaries. Normal mode collapses horizontal whitespace
// and trims hard-line edges; both modes retain explicit newlines. Pre mode expands
// tabs to column stops. Nonbreaking spaces are ordinary glyphs, never trimmed.
function normalize_runs(runs: Run[], pre: boolean, tab_size: number): Run[] {
  const result: Run[] = [];
  let column = 0, skip_lf = false;
  let pending: Style | undefined;
  for (const { text, style } of runs) {
    for (let char of text) {
      if (char === '\n' && skip_lf) { skip_lf = false; continue; }
      skip_lf = char === '\r';
      if (/[\r\v\f\u0085\u2028\u2029]/.test(char)) char = '\n';
      if (char === '\n') {
        append_run(result, char, style);
        pending = undefined; column = 0;
      } else if (!pre && (char === ' ' || char === '\t')) {
        if (column) pending = pending ?? style;
      } else {
        if (pending) { append_run(result, ' ', pending); column++; pending = undefined; }
        const value = char === '\t' ? ' '.repeat(tab_size - column % tab_size) : char;
        append_run(result, value, style);
        column += char === '\u200b' ? 0 : char === '\t' ? value.length : 1;
      }
    }
  }
  return result;
}

// Leading changes the line box, not the glyphs. A tight line height can put ink
// above/below that box; mixed runs share a baseline and contribute both extents.
function font_metrics(style: Style, fonts: FontProvider): Metrics {
  const font = fonts.resolve(style.font_family, style.font_weight, style.font_style);
  const ascent = font.ascent * style.font_size;
  const descent = font.descent * style.font_size;
  const height = resolve_line_height(style.line_height, style.font_size);
  const above = (height + ascent - descent) / 2;
  return { font, above, below: height - above };
}

// Break the entire logical string before intersecting it with style runs. Span
// boundaries therefore never introduce word breaks. Each legal break unit is
// measured once; subsequent offers only pack these prepared advances into lines.
function prepare_text(props: TextProps, query: LayoutQuery): PreparedText {
  const { whitespace = 'normal', tab_size = DEFAULTS.tab_size } = props;
  if (!['normal', 'pre'].includes(whitespace)) throw new TypeError('Unknown whitespace mode');
  if (!Number.isInteger(tab_size) || tab_size <= 0) throw new RangeError('tab_size must be positive');
  if (props.text !== undefined && props.children !== undefined) {
    throw new TypeError('Text accepts text or children, not both');
  }
  const raw: Run[] = [];
  collect_runs(props.text ?? props.children, query.style, query.path, raw);
  const runs = normalize_runs(raw, whitespace === 'pre', tab_size);
  const text = runs.map(run => run.text).join('');
  if (!text) return { text, tokens: [], above: 0, below: 0 };
  const fonts = query.resource<FontProvider>('fonts');
  const metrics = new Map<Style, Metrics>();
  const get_metrics = (style: Style) => {
    if (!metrics.has(style)) metrics.set(style, font_metrics(style, fonts));
    return metrics.get(style)!;
  };
  const strut = get_metrics(query.style);

  let offset = 0;
  const spans = runs.map(run => {
    const start = offset;
    offset += run.text.length;
    return { ...run, start, end: offset };
  });
  const breaker = new LineBreaker(text);
  const tokens: Token[] = [];
  let start = 0, run_index = 0;
  for (let next = breaker.nextBreak(); next; next = breaker.nextBreak()) {
    const end = next.position;
    const hard = text[end - 1] === '\n';
    const limit = hard ? end - 1 : end;
    const content = text.slice(start, limit);
    const core = whitespace === 'normal' ? content.replace(/ +$/, '') : content;
    const boundary = start + core.length;
    const parts: Part[] = [];
    let width = 0, gap = 0, above = strut.above, below = strut.below;

    // Preserve an inline run's own font metrics, even for whitespace or a newline.
    while (run_index < spans.length && spans[run_index].end <= start) run_index++;
    for (let index = run_index; index < spans.length && spans[index].start < end; index++) {
      const run = spans[index];
      const metrics = get_metrics(run.style);
      above = Math.max(above, metrics.above); below = Math.max(below, metrics.below);
      const from = Math.max(start, run.start);
      const to = Math.min(boundary, run.end);
      const value = text.slice(from, Math.max(from, to)).replace(/\u200b/g, '');
      if (value) {
        const shape = metrics.font.shape(value);
        parts.push({ shape, style: run.style, x: width });
        width += shape.advance * run.style.font_size;
      }
      const space = text.slice(Math.max(from, boundary), Math.min(limit, run.end));
      if (space) gap += metrics.font.shape(space).advance * run.style.font_size;
    }
    tokens.push({ parts, width, gap, hard, above, below });
    start = end;
  }
  return { text, tokens, above: strut.above, below: strut.below };
}

// Greedy word wrapping accepts an oversized first word, reporting overflow.
// Track the last content edge separately from pending space to avoid cancellation
// at exact break widths. A final explicit newline contributes a final blank line.
function flow_lines(prepared: PreparedText, budget: number): Line[] {
  const { tokens, above, below } = prepared;
  if (!tokens.length) return [];
  const lines: Line[] = [];
  let line: Line = { parts: [], width: 0, above, below };
  let cursor = 0, occupied = false;
  const finish = () => {
    lines.push(line);
    line = { parts: [], width: 0, above, below };
    cursor = 0; occupied = false;
  };
  for (const token of tokens) {
    if (occupied && cursor + token.width > budget) finish();
    line.parts.push(...token.parts.map(part => ({ ...part, x: cursor + part.x })));
    line.width = cursor + token.width;
    line.above = Math.max(line.above, token.above);
    line.below = Math.max(line.below, token.below);
    cursor = line.width + token.gap;
    occupied = true;
    if (token.hard) finish();
  }
  if (occupied || tokens.at(-1)!.hard) finish();
  return lines;
}

// Lines are result fragments, never reconstructed elements. Their drawing paths
// use fixed font pixels, with real ink independent of the allocated line boxes.
function text_layout(props: TextProps, query: LayoutQuery) {
  const { text_align = 'left', wrap = true } = props;
  if (!['left', 'center', 'right'].includes(text_align)) throw new TypeError('Unknown text_align');
  const prepared = query.prepare('text', () => prepare_text(props, query));
  const offer = query.request.width;
  const budget = wrap && offer.kind !== 'natural' ? offer.value : Infinity;
  const lines = flow_lines(prepared, budget);
  const width = Math.max(0, ...lines.map(line => line.width));
  const height = lines.reduce((sum, line) => sum + line.above + line.below, 0);
  const size = finish_size(make_size(width, height), query.request, query.sizing);
  let y = 0;
  const children = lines.map(line => {
    const draw = line.parts.map(({ shape, style, x }) => {
      const scale = style.font_size;
      const matrix = [scale, 0, 0, scale, x, line.above] as const;
      const commands = transform_path(shape.commands, matrix);
      const ink = transform_rect(shape.ink, make_point(), matrix);
      return draw_path(commands, { fill: style.color, stroke: 'none', stroke_width: 0, opacity: style.opacity }, ink);
    });
    const height = line.above + line.below;
    const fragment = make_fragment({
      name: 'Line', size: make_size(line.width, height), guides: { baseline: line.above }, draw,
    });
    const x = (size.width - line.width) * (text_align === 'left' ? 0 : text_align === 'center' ? 0.5 : 1);
    const placement = place_fragment(fragment, make_point(x, y));
    y += height;
    return placement;
  });
  const first = children[0], last = children.at(-1);
  const guides = first && last ? {
    baseline: first.fragment.guides.baseline,
    last_baseline: last.offset.y + last.fragment.guides.baseline!,
  } : {};
  return make_fragment({ size, guides, label: prepared.text, children });
}

class Text extends Element<TextProps> {
  static layout = text_layout;
}

class Span extends Element<SpanProps> {
  static layout = text_layout;
}

export { Text, Span };
export type { TextProps, TextOptions, SpanProps };
