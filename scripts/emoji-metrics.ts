// Core draws color emoji as live SVG text, so layout needs only their coverage
// and advances. Reduce the multi-megabyte web font to that: metrics, a format 12
// cmap, and an empty COLR table that still marks the face as a color font. Fonts
// bundles the result as its default fallback; hosts supply the font that paints.
//
//   bun scripts/emoji-metrics.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { create } from 'fontkit'
import type { Font } from 'fontkit'

type SourceFont = Font & {
  _cmapProcessor: { lookup(code_point: number): number }
  hmtx: { metrics: { length: number; get(index: number): { advance: number } } }
}

const source = new URL(import.meta.resolve('@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff2'))
const target = new URL('../src/fonts/NotoColorEmoji-Metrics.ttf', import.meta.url)
const font = create(readFileSync(source)) as SourceFont

// One glyph per code point, in code point order, after a blank .notdef.
const entries = [...font.characterSet].sort((a, b) => a - b).map(code_point => {
  const glyph = font._cmapProcessor.lookup(code_point)
  return { code_point, advance: font.hmtx.metrics.get(Math.min(glyph, font.hmtx.metrics.length - 1)).advance }
})
const glyphs = entries.length + 1
// Consecutive code points have consecutive glyphs, so each run is one cmap group.
const groups: { start: number; end: number; glyph: number }[] = []
entries.forEach(({ code_point }, index) => {
  const last = groups.at(-1)
  if (last && last.end + 1 === code_point) last.end = code_point
  else groups.push({ start: code_point, end: code_point, glyph: index + 1 })
})

function table(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size)
  write(new DataView(bytes.buffer))
  return bytes
}

const tables: Record<string, Uint8Array> = {
  COLR: new Uint8Array(4),
  cmap: table(28 + 12 * groups.length, view => {
    view.setUint16(2, 1); view.setUint16(4, 3); view.setUint16(6, 10); view.setUint32(8, 12)
    view.setUint16(12, 12); view.setUint32(16, 16 + 12 * groups.length); view.setUint32(24, groups.length)
    groups.forEach(({ start, end, glyph }, index) => {
      const at = 28 + 12 * index
      view.setUint32(at, start); view.setUint32(at + 4, end); view.setUint32(at + 8, glyph)
    })
  }),
  head: table(54, view => {
    view.setUint32(0, 0x00010000); view.setUint32(12, 0x5f0f3cf5); view.setUint16(18, font.unitsPerEm)
  }),
  hhea: table(36, view => {
    view.setUint32(0, 0x00010000); view.setInt16(4, font.ascent); view.setInt16(6, font.descent)
    view.setUint16(34, glyphs)
  }),
  hmtx: table(4 * glyphs, view => {
    entries.forEach(({ advance }, index) => view.setUint16(4 * (index + 1), advance))
  }),
  maxp: table(32, view => { view.setUint32(0, 0x00010000); view.setUint16(4, glyphs) }),
}

const tags = Object.keys(tables).sort()
const aligned = (size: number) => Math.ceil(size / 4) * 4
let offset = 12 + 16 * tags.length
const bytes = new Uint8Array(offset + tags.reduce((sum, tag) => sum + aligned(tables[tag].length), 0))
const view = new DataView(bytes.buffer)
view.setUint32(0, 0x00010000); view.setUint16(4, tags.length)
tags.forEach((tag, index) => {
  const record = 12 + 16 * index
  for (let char = 0; char < 4; char++) view.setUint8(record + char, tag.charCodeAt(char))
  view.setUint32(record + 8, offset); view.setUint32(record + 12, tables[tag].length)
  bytes.set(tables[tag], offset)
  offset += aligned(tables[tag].length)
})

writeFileSync(target, bytes)
console.log(`${entries.length} code points in ${groups.length} groups, ${bytes.length} bytes`)
