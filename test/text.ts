import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'opentype.js'
import { create } from 'fontkit'
import type { Font } from 'fontkit'
import {
  Fonts, EMOJI_FAMILY, LayoutPass, Text, Span, Svg, Rect, em, px, make_request, available, exact,
  resolve_style, render_svg, make_fragment, make_size, place_fragment, make_point, evaluate,
} from '../src/index'
import type { Drawing, FontProvider, Fragment, TextProps } from '../src/index'
import { color_font } from './fixtures/color_font'

const regular = readFileSync(new URL('../src/fonts/IBMPlexSans-Regular.ttf', import.meta.url))
const mono = readFileSync(new URL('../src/fonts/IBMPlexMono-Regular.ttf', import.meta.url))
const native = parse(regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength))
const shaper = create(regular) as Font

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}
function lines(fragment: Fragment): number { return fragment.children.length; }
function drawings(fragment: Fragment): Drawing[] {
  return [...fragment.draw, ...fragment.children.flatMap(child => drawings(child.fragment))]
}
// Emoji, a joined family, a keycap, and a space share one advance, as in real emoji
// fonts. The private use character is one that no bundled face covers.
const emoji = color_font([[0x20, 1200], [0x31, 1200], [0x20e3, 1200], [0x200d, 0], [0xe000, 1200],
  [0x1f468, 1200], [0x1f469, 1200], [0x1f600, 1200]])

const tests: Record<string, () => void> = {
  'named font weights render like numbers and inherit through text and spans'() {
    const pass = new LayoutPass()
    for (const [name, weight] of [['light', 300], ['regular', 400], ['normal', 400], ['bold', 700]] as const) {
      const style = resolve_style({ font_weight: name })
      assert.equal(style.font_weight, weight)
      assert.equal(resolve_style({}, style).font_weight, weight)
      assert.equal(resolve_style({ font_weight: 'normal' }, style).font_weight, 400)
      const children = new Text({ children: ['Inherited ', new Span({ font_weight: 'bold', children: 'bold' })] })
      const named = pass.layout(new Svg({ font_weight: name, children }))
      const numeric = pass.layout(new Svg({ font_weight: weight,
        children: new Text({ children: ['Inherited ', new Span({ font_weight: 700, children: 'bold' })] }) }))
      assert.equal(render_svg(named), render_svg(numeric))
    }
    for (const weight of [1, 350, 1000]) assert.equal(resolve_style({ font_weight: weight }).font_weight, weight)
  },

  'quoted JSX weights match constants on text, spans, and scoped titles'() {
    const pass = new LayoutPass()
    const source = `
      <TitleFrame title="Title" title-font-weight="bold">
        <Text font-weight="light">
          Light <Span font-weight="bold">bold</Span>
        </Text>
      </TitleFrame>
    `
    const quoted = pass.layout(evaluate(source))
    const constants = pass.layout(evaluate(source.replaceAll('="bold"', '={bold}').replaceAll('="light"', '={light}')))
    assert.equal(render_svg(quoted), render_svg(constants))
    assert.notEqual(render_svg(quoted), render_svg(pass.layout(evaluate(source.replaceAll('="bold"', '="regular"')))))
    for (const weight of ['heavy', 'constructor', 'toString']) {
      assert.throws(() => pass.layout(evaluate(`<Text font-weight="${weight}">Invalid</Text>`)), /font_weight must be a number/)
    }
    for (const weight of [0, 1001, NaN, Infinity]) {
      assert.throws(() => resolve_style({ font_weight: weight }), /weight/)
    }
  },

  'glyph advances, kerning, ink, and baselines come from the actual bundled font'() {
    const pass = new LayoutPass()
    const size = 24
    const fragment = pass.layout(new Text({ children: 'AVofficeJgy', font_size: px(size) }))
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
    const plain = pass.layout(new Text({ children: 'AV' }))
    const split = pass.layout(new Text({ children: ['A', new Span({ children: 'V' })] }))
    near(split.size.width, plain.size.width)
    const word = new Text({ children: ['extra', new Span({ color: 'red', children: 'ordinary' })] })
    const narrow = pass.layout(word, make_request({ width: exact(1) }))
    assert.equal(lines(narrow), 1)
    assert.ok(narrow.overflow.right > 50)
    assert.equal(narrow.children[0].fragment.draw.length, 2)
    const inline = pass.layout(new Text({ children: new Rect({ width: px(20), height: px(12) }) }))
    assert.equal(inline.children[0].fragment.children[0].fragment.name, 'Rect')
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
    const loose = pass.layout(new Text({ children: 'Jgy', font_size: px(24) }))
    const element = new Text({ children: 'Jgy', font_size: px(24), line_height: px(3) })
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
      assert.equal(lines(pass.layout(new Text({ children: text }))), count)
    }
    const normal = pass.layout(new Text({ children: [' \t one ', new Span({ children: '\t two\r' }), '\nthree  '] }))
    assert.equal(normal.label, 'one two\nthree'); assert.equal(lines(normal), 2)
    const pre = pass.layout(new Text({ children: 'a\tb  ', whitespace: 'pre', font_family: 'IBM Plex Mono' }))
    assert.equal(pre.label, 'a   b  ')
    near(pre.size.width, 7 * new Fonts().resolve('IBM Plex Mono', 400, 'normal').shape('a').advance * 16)
    const nbsp = pass.layout(new Text({ children: ' a\u00a0b c ' }), make_request({ width: exact(1) }))
    assert.equal(nbsp.label, 'a\u00a0b c'); assert.equal(lines(nbsp), 2)
    const zwsp = pass.layout(new Text({ children: 'a\u200bb' }), make_request({ width: exact(1) }))
    assert.equal(lines(zwsp), 2)
    const preserved = pass.layout(new Text({ children: '  ', whitespace: 'pre' }))
    assert.ok(preserved.size.width > 0); assert.equal(preserved.ink, null)
  },

  'wrapping, alignment, and shared size limits operate independently'() {
    const pass = new LayoutPass()
    const text = 'one two three'
    const nowrap = pass.layout(new Text({ children: text, wrap: false, width: px(10) }))
    assert.equal(lines(nowrap), 1); assert.equal(nowrap.size.width, 10)
    assert.ok(nowrap.overflow.right > 0)
    for (const [justify, fraction] of [['start', 0], ['center', 0.5], ['end', 1],
      [0, 0], [0.25, 0.25], [1, 1]] as const) {
      const fragment = pass.layout(new Text({ children: 'wide\ni', width: px(100), justify }))
      for (const child of fragment.children) {
        near(child.offset.x, (100 - child.fragment.size.width) * fraction)
      }
    }
    const limited = new Text({ children: text, max_width: px(30) })
    assert.equal(lines(pass.layout(limited)), 3)
    const forced = pass.layout(limited, make_request({ width: exact(200) }))
    assert.equal(lines(forced), 1); assert.equal(forced.size.width, 200)
  },

  'justify positions wrapped and overflowing lines and requires a single fraction or keyword'() {
    const pass = new LayoutPass()
    const props = { children: 'one two three four five', width: px(75) }
    const start = pass.layout(new Text(props))
    assert.deepEqual(start, pass.layout(new Text({ ...props, justify: 'start' })))
    const wrapped = pass.layout(new Text({ ...props, justify: 0.25 }))
    assert.ok(wrapped.children.length > 1)
    assert.deepEqual(wrapped.size, start.size)
    for (const [index, line] of wrapped.children.entries()) {
      near(line.offset.x, (wrapped.size.width - line.fragment.size.width) / 4)
      assert.deepEqual(line.fragment, start.children[index].fragment)
    }
    const overflow = pass.layout(new Text({ children: 'wide', width: px(5), wrap: false, justify: 'end' }))
    assert.ok(overflow.children[0].offset.x < 0 && overflow.overflow.left > 0)
    near(overflow.children[0].offset.x + overflow.children[0].fragment.size.width, 5)
    for (const justify of ['left', 'right', 'fill', 'stretch', 'space-between',
      -0.1, 1.1, NaN, Infinity, -Infinity, null, true, { x: 0.5 }, [0, 0.5]]) {
      assert.throws(() => pass.layout(new Text({ children: 'Label',
        justify: justify as TextProps['justify'] })), /justify/)
    }
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
    const root = new Svg({ width: px(100), height: px(40), children: new Text({ children: 'iii' }) })
    const before = pass.layout(root), svg = render_svg(before)
    // Parsing a sliced byte buffer must respect its offset and length.
    const buffer = new Uint8Array(mono.length + 14); buffer.set(mono, 7)
    fonts.register('IBM Plex Sans', buffer.subarray(7, 7 + mono.length))
    buffer.fill(0)
    pass.set_resource('fonts', fonts, fonts.version)
    const after = pass.layout(root)
    assert.ok(after.children[0].fragment.size.width > before.children[0].fragment.size.width)
    assert.equal(render_svg(before), svg)
    assert.throws(() => pass.layout(new Text({ font_family: 'missing', children: 'x' })), /Unknown font family/)
    assert.throws(() => pass.layout(new Text({ children: '\u{10ffff}' })), /U\+10FFFF/)
  },

  'a color face measures whole clusters from cmap and hmtx, with no outlines'() {
    for (const table of ['CBDT', 'sbix', 'COLR', 'SVG ']) {
      const fonts = new Fonts()
      fonts.register('Emoji', color_font([[0x1f600, 1200]], { table }))
      const shape = fonts.resolve('Emoji', 700, 'italic').shape('\u{1f600}')
      assert.equal(shape.commands.length, 0); assert.equal(shape.live?.family, 'Emoji')
    }
    const fonts = new Fonts()
    fonts.register("Joe's Emoji", emoji)
    const font = fonts.resolve("Joe's Emoji", 400, 'normal')
    near(font.ascent, 0.9); near(font.descent, 0.25)
    // A joiner and an unmapped selector ride on their base: one cluster, one advance.
    const text = '\u{1f600}\u{1f468}\u200d\u{1f469} 1\ufe0f\u20e3'
    assert.ok(font.has_glyphs(text))
    const shape = font.shape(text)
    assert.equal(font.shape(text), shape); assert.ok(Object.isFrozen(shape.live!.clusters[0]))
    assert.deepEqual(shape.live!.clusters.map(cluster => cluster.text),
      ['\u{1f600}', '\u{1f468}\u200d\u{1f469}', ' ', '1\ufe0f\u20e3'])
    near(shape.advance, 4.8); near(shape.live!.clusters[3].x, 3.6)
    assert.deepEqual(shape.ink, { x: 0, y: -0.9, width: shape.ink!.width, height: 1.15 })
    near(shape.ink!.width, 4.8)
    assert.equal(shape.live!.clusters[2].ink, null)
    // A selector needs a base, and ordinary letters remain another face's work.
    assert.ok(!font.has_glyphs('\ufe0f')); assert.ok(!font.has_glyphs('A'))
    assert.throws(() => font.shape('\u{1f600}A'), /Joe's Emoji has no glyph for U\+0041/)

    const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })
    const fragment = pass.layout(new Text({ children: '\u{1f600} \u{1f600}', font_family: "Joe's Emoji",
      font_size: px(20), color: '#123', opacity: 0.5 }))
    near(fragment.size.width, 3 * 24)
    const draw = drawings(fragment)
    assert.equal(draw.length, 2)
    const last = draw[1]
    assert.ok(last.kind === 'text' && Object.isFrozen(last))
    assert.deepEqual([last.text, last.font_family, last.font_size, last.fill, last.opacity],
      ['\u{1f600}', "Joe's Emoji", 20, '#123', 0.5])
    near(last.origin.x, 48); near(last.origin.y, fragment.guides.baseline!); near(last.advance, 24)
    near(fragment.ink!.x, 0); near(fragment.ink!.width, 72); near(fragment.ink!.height, 23)
    near(fragment.ink!.y, fragment.guides.baseline! - 18)
    const svg = render_svg(fragment)
    assert.match(svg, /<text x="60" y="[\d.]+" text-anchor="middle" font-family="&apos;Joe\\&apos;s Emoji&apos;"/)
    assert.match(svg, / font-size="20" fill="#123" opacity="0.5">\u{1f600}<\/text>/u)
    assert.doesNotMatch(svg, /<path/)
  },

  'uncovered clusters move to fallback faces while covered text keeps its face'() {
    // The bundled metrics face makes emoji work with no setup. It holds the coverage
    // and advances of Noto Color Emoji, and hosts paint that family themselves.
    const bundled = new Fonts()
    const noto = bundled.resolve(EMOJI_FAMILY, 400, 'normal')
    near(noto.shape('\u{1f600}').advance, 1275 / 1024); near(noto.ascent, 950 / 1024); near(noto.descent, 250 / 1024)
    assert.equal(bundled.fallback('\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u{1f1fa}\u{1f1f8}', 400, 'normal'), noto)
    const ready = new LayoutPass().layout(new Text({ children: 'hi \u{1f600}' }))
    const [word, face] = drawings(ready)
    assert.ok(word.kind === 'path' && face.kind === 'text' && face.font_family === 'Noto Color Emoji')
    near(face.advance, 16 * 1275 / 1024)
    // A provider with no fallback hook keeps the strict error.
    const strict: FontProvider = { resolve: (family, weight, style) => bundled.resolve(family, weight, style) }
    assert.throws(() => new LayoutPass({ fonts: { value: strict, version: 0 } })
      .layout(new Text({ children: 'hi \u{1f600}' })), /IBM Plex Sans has no glyph for U\+1F600/)
    // Registration alone makes a family available; only the flag makes it a fallback,
    // and fallbacks apply in registration order, after the bundled face.
    bundled.register('Private', emoji)
    assert.equal(bundled.fallback('\ue000', 400, 'normal'), undefined)
    assert.throws(() => bundled.register('Private', emoji, { fallback: 1 as unknown as boolean }), /Invalid font/)
    bundled.register('Private', emoji, { fallback: true })
    assert.equal(bundled.fallback('\ue000', 400, 'normal'), bundled.resolve('Private', 400, 'normal'))
    assert.equal(bundled.fallback('\u{1f600}', 400, 'normal'), bundled.resolve(EMOJI_FAMILY, 400, 'normal'))

    // Registering the bundled family again replaces it, here with exact test metrics.
    const fonts = new Fonts()
    fonts.register(EMOJI_FAMILY, emoji, { fallback: true })
    assert.equal(fonts.fallback('\u{1f600}', 700, 'italic'), fonts.resolve(EMOJI_FAMILY, 700, 'italic'))
    assert.equal(fonts.fallback('\u{1f680}', 400, 'normal'), undefined)
    const sans = fonts.resolve('IBM Plex Sans', 400, 'normal')
    const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })

    // Digits and spaces stay in Plex, although the emoji face also maps them. The
    // keycap moves as a whole cluster because Plex lacks its selector and cap.
    const text = 'AV1 \u{1f600}\u{1f468}\u200d\u{1f469}1\ufe0f\u20e3 AV'
    const fragment = pass.layout(new Text({ children: text }))
    const space = sans.shape(' ').advance
    near(fragment.size.width, 16 * (sans.shape('AV1').advance + sans.shape('AV').advance + 2 * space + 3 * 1.2))
    near(fragment.size.height, 16 * 1.2)
    assert.equal(fragment.label, text)
    const draw = drawings(fragment)
    assert.deepEqual(draw.map(item => item.kind), ['path', 'text', 'text', 'text', 'path'])
    const live = draw.filter(item => item.kind === 'text')
    assert.deepEqual(live.map(item => item.text), ['\u{1f600}', '\u{1f468}\u200d\u{1f469}', '1\ufe0f\u20e3'])
    near(live[1].origin.x - live[0].origin.x, 16 * 1.2)
    assert.ok(live.every(item => item.font_family === EMOJI_FAMILY && item.font_size === 16))

    // Emoji inside a word, around an inline element, and across a wrap stay intact.
    const mixed = pass.layout(new Text({ children: ['a\u{1f600}b ', new Rect({ width: px(10), height: px(10) }), ' \u{1f600}'] }))
    assert.equal(drawings(mixed).filter(item => item.kind === 'text').length, 2)
    assert.equal(lines(pass.layout(new Text({ children: '\u{1f600} \u{1f600} \u{1f600}' }), make_request({ width: exact(45) }))), 2)
    // Text that no face covers still reports the requested family.
    assert.throws(() => pass.layout(new Text({ children: '\u{1f600} \u{1f680}' })), /IBM Plex Sans has no glyph for U\+1F680/)

    // An outlined fallback face is drawn as paths like any other. Plex Mono lacks Greek.
    const outlined = new Fonts()
    assert.throws(() => outlined.resolve('IBM Plex Mono', 400, 'normal').shape('a\u03a9'), /U\+03A9/)
    outlined.register('Greek', regular, { fallback: true })
    const greek = new LayoutPass({ fonts: { value: outlined, version: outlined.version } })
    const replaced = greek.layout(new Text({ children: 'a\u03a9', font_family: 'IBM Plex Mono' }))
    assert.deepEqual(drawings(replaced).map(item => item.kind), ['path', 'path'])
    near(replaced.size.width, 16 * (outlined.resolve('IBM Plex Mono', 400, 'normal').shape('a').advance
      + sans.shape('\u03a9').advance))
  },

  'outlined SVG is self-contained, escaped, and renderable without a font resource'() {
    const pass = new LayoutPass()
    const fragment = pass.layout(new Text({ children: '<A & "B">', font_style: 'italic' }))
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
