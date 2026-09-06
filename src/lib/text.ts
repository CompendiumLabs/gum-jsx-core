// font shaping

/// <reference path="../types/linebreak.d.ts" />
/// <reference path="../types/opentype.d.ts" />
import EMOJI_REGEX from 'emojibase-regex'
import LineBreaker from 'linebreak'
import type { Font, Glyph } from 'opentype.js'

import { sans, light, regular } from './const'
import { is_string, compress_whitespace, sum, zip, max, min } from './utils'
import { wrapWidths } from './wrap'
import { isStrict, strictError } from './strict'
import { resolveEnv } from './default'
import { FontNotLoadedError, type FontSet, type FontEntry, type FontWeight } from '../fonts/fonts'
import type { Env } from '../env'

import type { Limit } from './types'

//
// create text sizer
//

function is_font_set(font: FontEntry): font is FontSet {
    return 'light' in font && 'regular' in font && 'bold' in font
}

function is_emoji(text: string): boolean {
    return EMOJI_REGEX.test(text)
}

type TextRun = {
    text: string
    emoji: boolean
}

const EMOJI_GLOBAL_REGEX = new RegExp(EMOJI_REGEX.source, EMOJI_REGEX.flags.includes('g') ? EMOJI_REGEX.flags : `${EMOJI_REGEX.flags}g`)

function splitEmojiRuns(text: string): TextRun[] {
    const runs: TextRun[] = []
    let last = 0
    EMOJI_GLOBAL_REGEX.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = EMOJI_GLOBAL_REGEX.exec(text)) != null) {
        const emoji = match[0]
        const start = match.index
        const end = start + emoji.length

        if (start > last) runs.push({ text: text.slice(last, start), emoji: false })
        if (emoji.length > 0) runs.push({ text: emoji, emoji: true })

        last = end
        if (EMOJI_GLOBAL_REGEX.lastIndex == start) EMOJI_GLOBAL_REGEX.lastIndex++
    }

    if (last < text.length) runs.push({ text: text.slice(last), emoji: false })
    EMOJI_GLOBAL_REGEX.lastIndex = 0
    return runs
}

const medium = 500

// match the browser result for the bundled 300/400/700 static faces
function closest_weight(weight: number): FontWeight {
    if (weight < regular) return 'light'
    if (weight <= medium) return 'regular'
    return 'bold'
}

// emoji are not measured from a font: every emoji glyph in Noto Emoji (the
// face gum used to ship, 2 MB) has the same advance, 1300/1024 em, and each
// run from splitEmojiRuns is one emoji sequence (a ZWJ family or a flag is one
// glyph), so a constant reproduces the measurement exactly. The emoji itself
// is drawn by whatever emoji face the renderer falls back to.
const EMOJI_ADVANCE = 1300 / 1024

function emojiSizer(_text: string): number {
    return EMOJI_ADVANCE
}

// the font is looked up in the registry of `env` (default: the default Env)
type TextSizerArgs = {
    font_family?: string
    font_weight?: number
    env?: Env
}

type Whitespace = 'normal' | 'pre' | 'preserve'

function textFont(font_family: string, font_weight: number, env?: Env): Font {
    // get font info
    const font = resolveEnv(env).fonts.get(font_family)
    if (font == null) throw new FontNotLoadedError(font_family)

    // match the static face browser font matching would select
    if (!is_font_set(font)) return font
    const weight = closest_weight(font_weight)
    return font[weight]
}

// a character the resolved face has no glyph for measures as .notdef (a
// quarter em) while the renderer draws it from whatever face it substitutes,
// so the text silently comes out mis-spaced; only checked in strict mode
function checkGlyphs(font: Font, text: string, font_family: string, env?: Env): void {
    for (const ch of text) {
        if (ch == ' ' || ch == '\n' || ch == '\t') continue
        if (font.charToGlyphIndex(ch) == 0) {
            const code = ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')
            strictError(env, 'glyph', `no glyph for U+${code} '${ch}' in '${font_family}'`)
        }
    }
}

// whether a face can actually draw every character of a string, so a caller
// can pick a different one rather than emit .notdef boxes
function textHasGlyphs(text: string, { font_family = sans, font_weight = light, env }: TextSizerArgs = {}): boolean {
    const font = textFont(font_family, font_weight, env)
    for (const ch of text) {
        if (ch == ' ' || ch == '\n' || ch == '\t') continue
        if (font.charToGlyphIndex(ch) == 0) return false
    }
    return true
}

//
// shaping memo
//

// shaping a string (opentype's bidi tokenizer plus its ccmp/liga lookups) is by
// far the costliest step of text layout, and the same word is measured many
// times over as the text elements clone through layout, so each string is
// shaped once per face: the glyph run, and from it the advance in em (the
// glyph advances plus the kerning between neighbors, as opentype's own
// getAdvanceWidth sums them). the faces are keyed weakly so a font swapped out
// of a registry takes its memo with it
type Shaped = { glyphs: Glyph[], advance: number }
const SHAPE_CACHE = new WeakMap<Font, Map<string, Shaped>>()

function shapeText(font: Font, text: string): Shaped {
    let cache = SHAPE_CACHE.get(font)
    if (cache == null) SHAPE_CACHE.set(font, cache = new Map())
    let shaped = cache.get(text)
    if (shaped == null) {
        const glyphs = font.stringToGlyphs(text)
        const units = font.unitsPerEm ?? 1000
        let width = 0
        for (let i = 0; i < glyphs.length; i++) {
            width += glyphs[i].advanceWidth ?? 0
            if (i < glyphs.length - 1) width += font.getKerningValue(glyphs[i].index, glyphs[i + 1].index)
        }
        cache.set(text, shaped = { glyphs, advance: width / units })
    }
    return shaped
}

function textSizer(text: string, { font_family = sans, font_weight = light, env }: TextSizerArgs = {}): number {
    const font = textFont(font_family, font_weight, env)
    const runs = splitEmojiRuns(text)
    if (isStrict(env)) runs.forEach(run => { if (!run.emoji) checkGlyphs(font, run.text, font_family, env) })
    return sum(runs.map(run =>
        run.emoji ? emojiSizer(run.text) : shapeText(font, run.text).advance
    ))
}

function fontVertical(font: Font, text: string): Limit {
    const { glyphs } = shapeText(font, text)
    const [yMins = [], yMaxs = []] = zip(...glyphs.map(g => [ g.yMin, g.yMax ]))
    const units = font.unitsPerEm ?? 1000
    const yMin = min(yMins) ?? 0
    const yMax = max(yMaxs) ?? units
    return [ yMin / units, yMax / units ]
}

function textVertical(text: string, { font_family = sans, font_weight = light, env }: TextSizerArgs = {}): Limit {
    const font = textFont(font_family, font_weight, env)
    return fontVertical(font, text)
}

// italic correction: how far the final glyph's ink overhangs its advance width
function textItalic(text: string, { font_family = sans, font_weight = light, env }: TextSizerArgs = {}): number {
    const font = textFont(font_family, font_weight, env)
    const { glyphs } = shapeText(font, text)
    const last = glyphs[glyphs.length - 1]
    if (last == null) return 0
    const { xMax = 0, advanceWidth = 0 } = last
    const units = font.unitsPerEm ?? 1000
    return Math.max(0, (xMax - advanceWidth) / units)
}

type TextMetrics = {
    advance: number
    vrange: Limit
    raw_vrange?: Limit
    italic?: number
}

const EMPTY_VRANGE: Limit = [ 0, 0 ]
const DEFAULT_VRANGE: Limit = [ -0.25, 0.75 ]

const EMPTY_METRICS: TextMetrics = {
    advance: 0,
    vrange: EMPTY_VRANGE,
    raw_vrange: EMPTY_VRANGE,
}

const DEFAULT_METRICS: TextMetrics = {
    advance: 1,
    vrange: DEFAULT_VRANGE,
    raw_vrange: DEFAULT_VRANGE,
}

function normalizeTextMetrics({ advance, vrange: [ ymin, ymax ], italic = 0 }: TextMetrics): TextMetrics {
    const yrange = ymax - ymin
    const line_height = Math.max(1, yrange)
    const font_height = 1 / line_height
    const glyph_top = (yrange > 1) ? 0.25 : 1 - ymax
    const baseline = glyph_top + ymax * font_height
    return {
        advance: advance / line_height,
        vrange: [ baseline - font_height, baseline ],
        raw_vrange: [ baseline - ymax * font_height, baseline - ymin * font_height ],
        italic: italic / line_height,
    }
}

// the inverse of normalizeTextMetrics: the glyph's advance, ink range above the
// baseline (y-up) and italic correction in em, as measured; null when the
// metrics carry no ink (an empty string)
function rawTextMetrics({ advance, vrange: [ vlo, vhi ], raw_vrange: [ rlo, rhi ] = [ vlo, vhi ], italic = 0 }: TextMetrics): TextMetrics | null {
    const fh = vhi - vlo
    if (fh <= 0 || rhi <= rlo) return null
    return { advance: advance / fh, vrange: [ (vhi - rhi) / fh, (vhi - rlo) / fh ], italic: italic / fh }
}

function textMetrics(text: string, args: TextSizerArgs & { whitespace?: Whitespace } = {}): TextMetrics {
    if (text == '\n') return { advance: 0, vrange: [ 0, 1 ], raw_vrange: [ 0, 1 ], italic: 0 }
    const text1 = args.whitespace === 'pre' || args.whitespace === 'preserve' ? text : compress_whitespace(text)
    const advance = textSizer(text1, args)
    const vrange = textVertical(text1, args)
    const italic = textItalic(text1, args)
    return normalizeTextMetrics({ advance, vrange, italic })
}

//
// text wrapping
//

function getBreaks(text: string): number[] {
    const breaker = new LineBreaker(text)
    const breaks = [0]
    for (let bk: any; (bk = breaker.nextBreak()); ) {
        breaks.push(bk.position)
    }
    if (breaks[breaks.length - 1] !== text.length) {
        breaks.push(text.length)
    }
    return breaks
}

function splitWords(text: string): string[] {
    const breaks = getBreaks(text)
    const words = breaks.slice(1).map((_b, i) => text.slice(breaks[i], breaks[i+1]))
    return words.map(w =>
        w.length > 1 && w.endsWith('\n') ?
        [ w.slice(0, -1), '\n' ] : w
    ).flat()
}

// compress whitespace, since that's what SVG does
function wrapText(text: string, maxWidth: number | undefined, args: TextSizerArgs = {}): { rows: string[][], widths: number[] } {
    const chunks = splitWords(compress_whitespace(text))
    const measure = (c: string) => textSizer(c, args)
    return wrapWidths(chunks, measure, maxWidth)
}

function mergeStrings(items: any[]): any[] {
    const lines: any[] = []
    let buffer = ''
    for (const item of items) {
        if (is_string(item)) {
            buffer += item
        } else {
            if (buffer.length > 0) {
                lines.push(buffer)
                buffer = ''
            }
            lines.push(item)
        }
    }
    if (buffer.length > 0) {
        lines.push(buffer)
    }
    return lines
}

//
// exports
//

export { is_emoji, textMetrics, rawTextMetrics, textSizer, textVertical, textItalic, textHasGlyphs, getBreaks, splitWords, wrapWidths, wrapText, mergeStrings }
export { DEFAULT_METRICS, EMPTY_METRICS, DEFAULT_VRANGE, EMPTY_VRANGE }
export type { TextMetrics, TextSizerArgs, Whitespace }
