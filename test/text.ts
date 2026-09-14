import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'opentype.js'
import { create } from 'fontkit'
import type { Font } from 'fontkit'
import {
  Fonts, LayoutPass, Text, Span, Svg, Rect, em, px, make_request, available, exact,
  resolve_style, render_svg, make_fragment, make_size, place_fragment, make_point,
} from '../src/index'
import type { FontProvider, Fragment } from '../src/index'

const regular = readFileSync(new URL('../src/fonts/IBMPlexSans-Regular.ttf', import.meta.url))
const mono = readFileSync(new URL('../src/fonts/IBMPlexMono-Regular.ttf', import.meta.url))
const native = parse(regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength))
const shaper = create(regular) as Font

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}
function lines(fragment: Fragment): number { return fragment.children.length; }

const tests: Record<string, () => void> = {
  'glyph advances, kerning, ink, and baselines come from the actual bundled font'() {
    const pass = new LayoutPass()
    const size = 24
    const fragment = pass.layout(new Text({ text: 'AVofficeJgy', font_size: px(size) }))
    const run = shaper.layout('AVofficeJgy')
    const scale = size / shaper.unitsPerEm
    near(fragment.size.width, run.advanceWidth * scale)
    near(fragment.size.height, size * 1.2)
    const leading = (size * 1.2 - (native.ascender - native.descender) * size / native.unitsPerEm) / 2
    const baseline = native.ascender * size / native.unitsPerEm + leading
    near(fragment.guides.baseline!, baseline)
    const ink = run.bbox
    assert.ok(fragment.ink)
    near(fragment.ink.x, ink.minX * scale); near(fragment.ink.y, baseline - ink.maxY * scale)
    near(fragment.ink.width, ink.width * scale); near(fragment.ink.height, ink.height * scale)
    // Plex uses extension positioning tables that the old OpenType adapter skipped.
    assert.equal(shaper.layout('AV').advanceWidth, 1209)
    assert.ok(shaper.layout('AV').advanceWidth
      < shaper.layout('A').advanceWidth + shaper.layout('V').advanceWidth)
    assert.ok(run.glyphs.some(glyph => glyph.isLigature))
    assert.deepEqual(pass.stats, { queries: 1, layouts: 1, hits: 0 })
  },

  'reflow reuses prepared measurements and keeps exact wrap boundaries distinct'() {
    const fonts = new Fonts()
    let measured = 0, resolved = 0
    const provider: FontProvider = { resolve(family, weight, style) {
      resolved++
      const font = fonts.resolve(family, weight, style)
      return { ...font, shape(text) { measured++; return font.shape(text); } }
    } }
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } })
    const element = new Text({ children: ['one ', new Span({ font_weight: 700, children: 'two' })] })
    const natural = pass.layout(element)
    const before = { measured, resolved }
    const edge = make_request({ width: exact(natural.size.width) })
    const at = pass.layout(element, edge)
    const below = pass.layout(element, make_request({ width: exact(natural.size.width - 1e-9) }))
    assert.equal(lines(at), 1); assert.equal(lines(below), 2)
    assert.equal(pass.layout(element, edge), at)
    assert.deepEqual({ measured, resolved }, before)
    near(below.size.height, at.size.height * 2)
    assert.equal(pass.stats.layouts, 3)
    assert.equal(pass.stats.hits, 1)
  },

  'span boundaries preserve words and equivalent spans preserve kerning'() {
    const pass = new LayoutPass()
    const plain = pass.layout(new Text({ text: 'AV' }))
    const split = pass.layout(new Text({ children: ['A', new Span({ children: 'V' })] }))
    near(split.size.width, plain.size.width)
    const word = new Text({ children: ['extra', new Span({ color: 'red', children: 'ordinary' })] })
    const narrow = pass.layout(word, make_request({ width: exact(1) }))
    assert.equal(lines(narrow), 1)
    assert.ok(narrow.overflow.right > 50)
    assert.equal(narrow.children[0].fragment.draw.length, 2)
    assert.throws(() => pass.layout(new Text({ children: new Rect() })), /strings, numbers, or Spans/)
  },

  'font inheritance precedes measurement and mixed sizes share their true baseline'() {
    const pass = new LayoutPass()
    const text = new Text({ font_size: 0.5, children: ['A', new Span({ font_size: em(2), children: 'g' })] })
    const context = { style: resolve_style({ font_size: px(20), color: '#234', line_height: em(1.2) }) }
    const fragment = pass.layout(text, make_request(), context)
    const small = native.getAdvanceWidth('A', 10), large = native.getAdvanceWidth('g', 20)
    near(fragment.size.width, small + large)
    near(fragment.size.height, 24)
    near(fragment.guides.baseline!, 19.5)
    const draw = fragment.children[0].fragment.draw
    assert.ok(draw[0].kind === 'path' && draw[1].kind === 'path')
    near(draw[0].bounds!.height, native.getPath('A', 0, 0, 10).getBoundingBox().y2
      - native.getPath('A', 0, 0, 10).getBoundingBox().y1)
    near(draw[1].bounds!.x, small + native.getPath('g', 0, 0, 20).getBoundingBox().x1)
    assert.equal(draw[0].fill, '#234'); assert.equal(draw[1].fill, '#234')
    const bigger = pass.layout(text, make_request(), { style: resolve_style({ font_size: px(40) }) })
    near(bigger.size.width, fragment.size.width * 2)
    near(bigger.size.height, fragment.size.height * 2)
  },

  'tight line heights and exact frames report overflow without shrinking glyphs'() {
    const pass = new LayoutPass()
    const loose = pass.layout(new Text({ text: 'Jgy', font_size: px(24) }))
    const element = new Text({ text: 'Jgy', font_size: px(24), line_height: px(3) })
    const tight = pass.layout(element)
    near(tight.size.width, loose.size.width)
    near(tight.size.height, 3)
    near(tight.ink!.height, loose.ink!.height)
    assert.ok(tight.overflow.top > 0 && tight.overflow.bottom > 0)
    const zero = pass.layout(element, make_request({ width: exact(0), height: exact(0) }))
    assert.deepEqual(zero.size, { width: 0, height: 0 })
    assert.ok(zero.overflow.right > 0 && zero.overflow.bottom > 0)
    near(zero.ink!.height, loose.ink!.height)
    const soft = pass.layout(element, make_request({ width: available(0), height: available(0) }))
    near(soft.size.width, loose.size.width); near(soft.size.height, 3)
  },

  'newlines, tabs, spaces, and nonbreaking spaces have explicit behavior'() {
    const pass = new LayoutPass()
    for (const [text, count] of [['', 0], ['   ', 0], ['\n', 2], ['a\n', 2], ['\n\n', 3]] as const) {
      assert.equal(lines(pass.layout(new Text({ text }))), count)
    }
    const normal = pass.layout(new Text({ children: [' \t one ', new Span({ children: '\t two\r' }), '\nthree  '] }))
    assert.equal(normal.label, 'one two\nthree'); assert.equal(lines(normal), 2)
    const pre = pass.layout(new Text({ text: 'a\tb  ', whitespace: 'pre', font_family: 'IBM Plex Mono' }))
    assert.equal(pre.label, 'a   b  ')
    near(pre.size.width, 7 * new Fonts().resolve('IBM Plex Mono', 400, 'normal').shape('a').advance * 16)
    const nbsp = pass.layout(new Text({ text: ' a\u00a0b c ' }), make_request({ width: exact(1) }))
    assert.equal(nbsp.label, 'a\u00a0b c'); assert.equal(lines(nbsp), 2)
    const zwsp = pass.layout(new Text({ text: 'a\u200bb' }), make_request({ width: exact(1) }))
    assert.equal(lines(zwsp), 2)
    const preserved = pass.layout(new Text({ text: '  ', whitespace: 'pre' }))
    assert.ok(preserved.size.width > 0); assert.equal(preserved.ink, null)
  },

  'wrapping, alignment, and shared size limits operate independently'() {
    const pass = new LayoutPass()
    const text = 'one two three'
    const nowrap = pass.layout(new Text({ text, wrap: false, width: px(10) }))
    assert.equal(lines(nowrap), 1); assert.equal(nowrap.size.width, 10)
    assert.ok(nowrap.overflow.right > 0)
    for (const text_align of ['left', 'center', 'right'] as const) {
      const fragment = pass.layout(new Text({ text: 'wide\ni', width: px(100), text_align }))
      for (const child of fragment.children) {
        const fraction = text_align === 'left' ? 0 : text_align === 'center' ? 0.5 : 1
        near(child.offset.x, (100 - child.fragment.size.width) * fraction)
      }
    }
    const limited = new Text({ text, max_width: px(30) })
    assert.equal(lines(pass.layout(limited)), 3)
    const forced = pass.layout(limited, make_request({ width: exact(200) }))
    assert.equal(lines(forced), 1); assert.equal(forced.size.width, 200)
  },

  'font faces, italic synthesis, registration, and versioned resources are independent'() {
    const fonts = new Fonts()
    const normal = fonts.resolve('IBM Plex Sans', 400, 'normal').shape('Jgy')
    const italic = fonts.resolve('IBM Plex Sans', 400, 'italic').shape('Jgy')
    near(italic.advance, normal.advance); near(italic.ink!.height, normal.ink!.height)
    assert.notDeepEqual(italic.commands, normal.commands)
    for (const family of ['IBM Plex Sans', 'IBM Plex Mono']) {
      for (const weight of [300, 400, 700]) assert.ok(fonts.resolve(family, weight, 'normal').shape('Ag').ink)
    }
    assert.equal(fonts.resolve('IBM Plex Sans', 600, 'normal'), fonts.resolve('IBM Plex Sans', 700, 'normal'))
    const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })
    const root = new Svg({ width: px(100), height: px(40), children: new Text({ text: 'iii' }) })
    const before = pass.layout(root), svg = render_svg(before)
    // Parsing a sliced byte buffer must respect its offset and length.
    const buffer = new Uint8Array(mono.length + 14); buffer.set(mono, 7)
    fonts.register('IBM Plex Sans', buffer.subarray(7, 7 + mono.length))
    buffer.fill(0)
    pass.set_resource('fonts', fonts, fonts.version)
    const after = pass.layout(root)
    assert.ok(after.children[0].fragment.size.width > before.children[0].fragment.size.width)
    assert.equal(render_svg(before), svg)
    assert.throws(() => pass.layout(new Text({ font_family: 'missing', text: 'x' })), /Unknown font family/)
    assert.throws(() => pass.layout(new Text({ text: '\u{10ffff}' })), /U\+10FFFF/)
  },

  'outlined SVG is self-contained, escaped, and renderable without a font resource'() {
    const pass = new LayoutPass()
    const fragment = pass.layout(new Text({ text: '<A & "B">', font_style: 'italic' }))
    const before = pass.stats
    const root = make_fragment({ size: make_size(180, 40), children: [place_fragment(fragment, make_point(5, 5))] })
    pass.set_resource('fonts', null, 1)
    const svg = render_svg(root)
    assert.match(svg, /<path d="M/)
    assert.match(svg, /aria-label="&lt;A &amp; &quot;B&quot;&gt;"/)
    assert.doesNotMatch(svg, /<text|font-family|@font-face/)
    assert.deepEqual(pass.stats, before)
    assert.ok(Object.isFrozen(fragment.children[0].fragment.draw[0]))
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} text checks passed.`)
