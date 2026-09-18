import { create } from 'fontkit'
import type { Font, PathCommand as FontCommand } from 'fontkit'
import { nonnegative } from '../lib/checks'
import { make_rect, union_rects } from './geometry'
import type { Rect } from './geometry'
import { copy_path } from './path'
import type { PathCommand } from './path'
import type { FontStyle } from './style'

// Measurements and outlines use a one-em font, with y down and baseline at zero.
// A provider may replace Fontkit without changing text flow or SVG rendering.
// A color face has no fillable outline. Its shapes carry measured source
// clusters instead, which the host draws as live text in the named family.
type LiveCluster = Readonly<{ text: string; x: number; advance: number; ink: Rect | null }>
type GlyphShape = Readonly<{
  advance: number
  commands: readonly PathCommand[]
  ink: Rect | null
  live?: Readonly<{ family: string; clusters: readonly LiveCluster[] }>
}>
type MeasuredFont = Readonly<{
  ascent: number
  descent: number
  has_glyphs: (text: string) => boolean
  shape: (text: string) => GlyphShape
}>
// A provider may name a face for text that the requested one cannot shape.
interface FontProvider {
  resolve(family: string, weight: number, style: FontStyle): MeasuredFont
  fallback?(text: string, weight: number, style: FontStyle): MeasuredFont | undefined
}
type FontOptions = Readonly<{ weight?: number; style?: FontStyle; fallback?: boolean }>
type FontData = ArrayBuffer | Uint8Array
type Face = {
  family: string; weight: number; style: FontStyle; fallback: boolean; url?: URL; font?: Font
  pending?: Promise<void>
}

// Hosts paint live emoji themselves, under this family name.
const EMOJI_FAMILY = 'Noto Color Emoji'

class FontNotLoadedError extends Error {
  constructor(readonly family: string) {
    super(`Load ${family} with fonts.load() before layout`)
    this.name = 'FontNotLoadedError'
  }
}

class MissingGlyphError extends Error {
  constructor(readonly family: string, readonly code_point: number) {
    const code = code_point.toString(16).toUpperCase().padStart(4, '0')
    super(`${family} has no glyph for U+${code}`)
    this.name = 'MissingGlyphError'
  }
}

function font_options(family: string, { weight = 400, style = 'normal', fallback = false }: FontOptions) {
  if (!family || !Number.isFinite(weight) || weight < 1 || weight > 1000
    || !['normal', 'italic'].includes(style) || typeof fallback !== 'boolean') {
    throw new TypeError('Invalid font registration')
  }
  return { family, weight, style, fallback }
}

// Access local files only on demand. Importing core performs no host I/O and
// browser hosts can preload with load(), register bytes, or supply a provider.
function local_fs(): typeof import('node:fs') | undefined {
  const host = globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }
  return host.process?.getBuiltinModule?.('node:fs') as typeof import('node:fs') | undefined
}

function parse_font(data: FontData): Font {
  // Fontkit consumes Uint8Array, although its declarations still specify Buffer.
  // Own the bytes: parsing is lazy and may access them after registration returns.
  const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data.slice(0))
  const font = create(bytes as Buffer)
  if (!('unitsPerEm' in font)) throw new TypeError('Register individual faces, not font collections')
  if (!(font.unitsPerEm > 0)) throw new RangeError('Font unitsPerEm must be positive')
  fix_empty_glyphs(font)
  return font
}

// Fontkit 2.0.4 reads a glyf header even when loca says the glyph is empty.
// Plex Mono's trailing space glyphs then read past the table. Give only those
// glyph instances their correct zero bounds; advances still come from hmtx.
// Keep this dependency workaround inside the adapter, with no global patch.
function fix_empty_glyphs(font: Font): void {
  const offsets = (font as Font & { loca?: { offsets: number[] } }).loca?.offsets
  if (!offsets) return
  const bounds = Object.freeze({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 })
  for (let index = 0; index < font.numGlyphs; index++) {
    if (offsets[index] === offsets[index + 1]) {
      Object.defineProperty(font.getGlyph(index), '_getCBox', { value: () => bounds })
    }
  }
}

// Translate the font library's path vocabulary at this single boundary.
function font_command({ command, args }: FontCommand): PathCommand {
  switch (command) {
    case 'moveTo': return { kind: 'M', x: args[0], y: args[1] }
    case 'lineTo': return { kind: 'L', x: args[0], y: args[1] }
    case 'quadraticCurveTo': return { kind: 'Q', x1: args[0], y1: args[1], x: args[2], y: args[3] }
    case 'bezierCurveTo': return { kind: 'C', x1: args[0], y1: args[1], x2: args[2], y2: args[3],
      x: args[4], y: args[5] }
    case 'closePath': return { kind: 'Z' }
  }
}

// Bitmap and layered color glyphs cannot become one filled path, and Fontkit
// builds no glyph at all for a CBDT face. Read only cmap and hmtx: every emoji
// font gives its sequences one shared advance, so a grapheme cluster takes the
// advance of its base. Joiners, selectors, and tags need no mapping of their own.
const COLOR_TABLES = ['CBDT', 'sbix', 'COLR', 'SVG ']
const IGNORABLE = /^[\u200c\u200d\ufe00-\ufe0f\u{e0020}-\u{e007f}\u{e0100}-\u{e01ef}]$/u
type ColorFont = Font & {
  directory: { tables: Record<string, unknown> }
  _cmapProcessor: { lookup(code_point: number): number }
  hmtx: { metrics: { length: number; get(index: number): { advance: number } } }
}

function is_color(font: Font): font is ColorFont {
  const tables = (font as ColorFont).directory?.tables ?? {}
  return COLOR_TABLES.some(tag => tag in tables)
}

function graphemes(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return [...segmenter.segment(text)].map(item => item.segment)
}

function measure_color(font: ColorFont, family: string): MeasuredFont {
  const cache = new Map<string, GlyphShape>()
  const scale = 1 / font.unitsPerEm
  const ascent = nonnegative(font.ascent * scale, 'font ascent')
  const descent = nonnegative(-font.descent * scale, 'font descent')
  const missing = (cluster: string) => [...cluster].find((char, index) =>
    !font.hasGlyphForCodePoint(char.codePointAt(0)!) && (index === 0 || !IGNORABLE.test(char)))
  const has_glyphs = (text: string) => graphemes(text).every(cluster => missing(cluster) === undefined)
  return Object.freeze({ ascent, descent, has_glyphs, shape(text: string): GlyphShape {
    const cached = cache.get(text)
    if (cached) return cached
    let x = 0, ink: Rect | null = null
    const clusters = graphemes(text).map(cluster => {
      const absent = missing(cluster)
      if (absent !== undefined) throw new MissingGlyphError(family, absent.codePointAt(0)!)
      const glyph = font._cmapProcessor.lookup(cluster.codePointAt(0)!)
      const metric = font.hmtx.metrics.get(Math.min(glyph, font.hmtx.metrics.length - 1))
      const advance = nonnegative(metric.advance * scale, 'glyph advance')
      // A color glyph fills its em box; blank clusters advance without painting.
      const box = advance && cluster.trim() ? make_rect(x, -ascent, advance, ascent + descent) : null
      ink = union_rects(ink, box)
      const result = Object.freeze({ text: cluster, x, advance, ink: box })
      x += advance
      return result
    })
    const live = Object.freeze({ family, clusters: Object.freeze(clusters) })
    const result = Object.freeze({ advance: x, commands: copy_path([]), ink, live })
    cache.set(text, result)
    return result
  } })
}

// Keep real kerning and ligatures within each shaped run. Italic requests use
// a matching face when available, or a 12-degree oblique of the normal outline.
function measure_font(font: Font, family: string, oblique: boolean): MeasuredFont {
  if (is_color(font)) return measure_color(font, family)
  const cache = new Map<string, GlyphShape>()
  const ascent = nonnegative(font.ascent / font.unitsPerEm, 'font ascent')
  const descent = nonnegative(-font.descent / font.unitsPerEm, 'font descent')
  const has_glyphs = (text: string) => [...text].every(char => font.hasGlyphForCodePoint(char.codePointAt(0)!))
  return Object.freeze({ ascent, descent, has_glyphs, shape(text: string): GlyphShape {
    const cached = cache.get(text)
    if (cached) return cached
    for (const char of text) {
      if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) {
        throw new MissingGlyphError(family, char.codePointAt(0)!)
      }
    }

    const run = font.layout(text)
    const scale = 1 / font.unitsPerEm
    const skew = oblique ? Math.tan(Math.PI / 15) : 0
    const commands: PathCommand[] = []
    let x = 0, y = 0, ink: Rect | null = null
    run.glyphs.forEach((glyph, index) => {
      const { xAdvance, yAdvance, xOffset, yOffset } = run.positions[index]
      const dx = (x + xOffset) * scale, dy = -(y + yOffset) * scale
      const path = glyph.path.transform(scale, 0, skew * scale, -scale, dx - skew * dy, dy)
      commands.push(...path.commands.map(font_command))
      if (path.commands.length) {
        const { minX, minY, width, height } = path.bbox
        ink = union_rects(ink, make_rect(minX, minY, width, height))
      }
      x += xAdvance; y += yAdvance
    })

    // Curve extrema give tight ink, separately from the shaped advance width.
    const advance = nonnegative(x * scale, 'glyph advance')
    const result = Object.freeze({ advance, commands: copy_path(commands), ink })
    cache.set(text, result)
    return result
  } })
}

class Fonts implements FontProvider {
  #faces: Face[] = []
  #measured = new Map<string, MeasuredFont>()
  #version = 0

  // Bundled faces are metadata until first use; no old registry or Env is involved.
  constructor() {
    for (const family of ['Sans', 'Mono']) {
      for (const [name, weight] of [['Light', 300], ['Regular', 400], ['Bold', 700]] as const) {
        this.#faces.push({
          family: `IBM Plex ${family}`, weight, style: 'normal', fallback: false,
          url: new URL(`../fonts/IBMPlex${family}-${name}.ttf`, import.meta.url),
        })
      }
    }
    // Emoji are only measured here: this small face holds the coverage and advances
    // of Noto Color Emoji (scripts/emoji-metrics.ts), and no glyph data at all.
    this.#faces.push({
      family: EMOJI_FAMILY, weight: 400, style: 'normal', fallback: true,
      url: new URL('../fonts/NotoColorEmoji-Metrics.ttf', import.meta.url),
    })
  }

  get version(): number { return this.#version; }

  // Registration copies/parses bytes now. Notify a reused pass of this new version.
  register(family: string, data: FontData, options: FontOptions = {}): void {
    const face = { ...font_options(family, options), font: parse_font(data) }
    this.#register(face)
  }

  // Register asset metadata without I/O. Identical registration preserves loaded
  // bytes and in-flight requests; replacement invalidates measured faces.
  register_url(family: string, url: URL, options: FontOptions = {}): void {
    const face = { ...font_options(family, options), url: new URL(url.href) }
    const old = this.#faces.find(item => item.family === family
      && item.weight === face.weight && item.style === face.style)
    if (old?.url?.href === face.url.href && old.fallback === face.fallback) return
    this.#register(face)
  }

  #register(face: Face): void {
    this.#faces = this.#faces.filter(item =>
      item.family !== face.family || item.weight !== face.weight || item.style !== face.style)
    this.#faces.push(face)
    this.#measured.clear()
    this.#version++
  }

  // Optional asynchronous preload for hosts without synchronous file access.
  async load(family?: string): Promise<void> {
    await Promise.all(this.#faces.filter(face => !family || face.family === family).map(async face => {
      if (face.font || !face.url) return
      if (!face.pending) {
        const url = face.url
        face.pending = (async () => {
          const fs = url.protocol === 'file:' ? local_fs() : undefined
          if (fs) { face.font = parse_font(fs.readFileSync(url)); return; }
          const response = await fetch(url)
          if (!response.ok) throw new Error(`Unable to load font: ${url} (${response.status})`)
          face.font = parse_font(await response.arrayBuffer())
        })().finally(() => { face.pending = undefined })
      }
      await face.pending
    }))
  }

  // Prefer the requested style, then the nearest available weight (lower on ties).
  resolve(family: string, weight: number, style: FontStyle): MeasuredFont {
    const faces = this.#faces.filter(face => face.family === family)
    if (!faces.length) throw new Error(`Unknown font family: ${family}`)
    const matching = faces.filter(face => face.style === style)
    const face = (matching.length ? matching : faces).sort((a, b) =>
      Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || a.weight - b.weight)[0]
    const oblique = style === 'italic' && face.style === 'normal'
    const key = JSON.stringify([family, face.weight, face.style, oblique])
    const cached = this.#measured.get(key)
    if (cached) return cached

    if (!face.font) {
      const fs = face.url?.protocol === 'file:' ? local_fs() : undefined
      if (!fs || !face.url) throw new FontNotLoadedError(family)
      face.font = parse_font(fs.readFileSync(face.url))
    }
    const measured = measure_font(face.font, family, oblique)
    this.#measured.set(key, measured)
    return measured
  }

  // Fallback families apply in registration order, and load only once needed.
  fallback(text: string, weight: number, style: FontStyle): MeasuredFont | undefined {
    const families = new Set(this.#faces.filter(face => face.fallback).map(face => face.family))
    for (const family of families) {
      const font = this.resolve(family, weight, style)
      if (font.has_glyphs(text)) return font
    }
  }
}

export { Fonts, FontNotLoadedError, MissingGlyphError, EMOJI_FAMILY }
export { graphemes }
export type { GlyphShape, LiveCluster, MeasuredFont, FontProvider, FontOptions, FontData }
