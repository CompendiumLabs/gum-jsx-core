// Build the smallest face Fontkit accepts: metrics, a format 12 cmap, and the
// tag of a color table. Fontkit decodes lazily and never reads the color data,
// exactly as with a real bitmap emoji font, so tests need no licensed binary.
type ColorFontOptions = Readonly<{
  units?: number; ascent?: number; descent?: number; table?: string
}>

function table_bytes(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size)
  write(new DataView(bytes.buffer))
  return bytes
}

// Each entry maps one code point to its own glyph and advance; glyph 0 is .notdef.
function color_font(entries: readonly (readonly [number, number])[], options: ColorFontOptions = {}): Uint8Array {
  const { units = 1000, ascent = 900, descent = 250, table = 'CBDT' } = options
  const sorted = [...entries].sort((a, b) => a[0] - b[0])
  const glyphs = sorted.length + 1
  const tables: Record<string, Uint8Array> = {
    head: table_bytes(54, view => {
      view.setUint32(0, 0x00010000); view.setUint32(12, 0x5f0f3cf5); view.setUint16(18, units)
    }),
    hhea: table_bytes(36, view => {
      view.setUint32(0, 0x00010000); view.setInt16(4, ascent); view.setInt16(6, -descent)
      view.setUint16(34, glyphs)
    }),
    maxp: table_bytes(32, view => { view.setUint32(0, 0x00010000); view.setUint16(4, glyphs) }),
    hmtx: table_bytes(4 * glyphs, view => {
      sorted.forEach(([, advance], index) => view.setUint16(4 * (index + 1), advance))
    }),
    cmap: table_bytes(12 + 16 + 12 * sorted.length, view => {
      view.setUint16(2, 1); view.setUint16(4, 3); view.setUint16(6, 10); view.setUint32(8, 12)
      view.setUint16(12, 12); view.setUint32(16, 16 + 12 * sorted.length); view.setUint32(24, sorted.length)
      sorted.forEach(([code_point], index) => {
        const at = 28 + 12 * index
        view.setUint32(at, code_point); view.setUint32(at + 4, code_point); view.setUint32(at + 8, index + 1)
      })
    }),
    [table]: new Uint8Array(4),
  }

  const tags = Object.keys(tables).sort()
  const aligned = (size: number) => Math.ceil(size / 4) * 4
  let offset = 12 + 16 * tags.length
  const size = offset + tags.reduce((sum, tag) => sum + aligned(tables[tag].length), 0)
  const font = new Uint8Array(size), view = new DataView(font.buffer)
  view.setUint32(0, 0x00010000); view.setUint16(4, tags.length)
  tags.forEach((tag, index) => {
    const record = 12 + 16 * index
    for (let char = 0; char < 4; char++) view.setUint8(record + char, tag.charCodeAt(char))
    view.setUint32(record + 8, offset); view.setUint32(record + 12, tables[tag].length)
    font.set(tables[tag], offset)
    offset += aligned(tables[tag].length)
  })
  return font
}

export { color_font }
export type { ColorFontOptions }
