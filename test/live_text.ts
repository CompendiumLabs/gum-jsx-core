import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Fonts, LayoutPass, Text, Span, Box, Rect, px, em, render_element, layout_element, render_svg, draw_text,
  make_point, make_rect, make_fragment, output_number_formatter } from '../src'
import type { Drawing, Fragment, FontProvider } from '../src'
import { color_font } from './fixtures/color_font'
import { copy_drawing } from '../src/engine/drawing'

const drawings = (fragment: Fragment): Drawing[] => [...fragment.draw,
  ...fragment.children.flatMap(child => drawings(child.fragment))]
function geometry(fragment: Fragment): unknown {
  const { draw, children, ...rest } = fragment
  return { ...rest, children: children.map(child => ({ ...child, fragment: geometry(child.fragment) })) }
}
const fonts = new Fonts()
const element = new Box({ width: px(145), children: new Text({ font_size: px(20), line_height: em(1.4), children: [
  'AV office ', new Span({ font_weight: 650, children: 'bold &' }), ' ',
  new Span({ font_style: 'italic', children: '<italic>' }), ' ',
  new Rect({ width: px(10), height: px(10) }), ' end',
] }) })
const paths = render_element(element, { fonts })
const live = render_element(element, { fonts, text_mode: 'live' })
assert.deepEqual(geometry(live.fragment), geometry(paths.fragment))
assert.equal(render_element(element, { fonts, text_mode: 'path' }).svg, paths.svg)
assert.doesNotMatch(paths.svg, /<text /)
assert.doesNotMatch(paths.svg, /text-anchor=|font-weight=|font-style=|xml:space=/)
assert.doesNotMatch(live.svg, /role=|aria-label=|<g>/)
assert.doesNotMatch(live.svg, /<text [^>]*(?:text-anchor="start"|font-weight="400"|font-style="normal")/)
assert.match(live.svg, /^<svg [^>]*text-anchor="start" font-weight="400" font-style="normal"/)
assert.match(live.svg, /font-family="IBM Plex Sans"/)
assert.match(live.svg, /font-weight="700"/)
assert.match(live.svg, /font-style="oblique 12deg"/)
assert.match(live.svg, />&lt;italic&gt;<\/text>/)
assert.match(live.svg, />&amp;<\/(?:text|tspan)>/)
assert.deepEqual(drawings(live.fragment).map(draw => draw.kind === 'text' ? draw.bounds : draw),
  drawings(paths.fragment).map(draw => draw.kind === 'path' ? draw.bounds : draw))
console.log('ok - live text preserves wrapping, placement, ink, inline elements, resolved weights and oblique faces')

// Each line shares typography without letting the browser choose word spacing.
const paragraph = render_element(new Text({ children: 'one two three\nfour five', opacity: 0.5 }), { fonts, text_mode: 'live' })
const runs = [...paragraph.svg.matchAll(/<text ([^>]*)>(.*?)<\/text>/g)]
assert.equal(runs.length, 2)
assert.equal((paragraph.svg.match(/font-family=/g) ?? []).length, 2)
assert.ok(runs.every(run => !run[1].includes('opacity=')))
const words = [...paragraph.svg.matchAll(/<tspan x="([^"]+)" opacity="0.5">([^<]*)<\/tspan>/g)]
const measuredWords = drawings(paragraph.fragment).filter(draw => draw.kind === 'text')
const number = output_number_formatter()
assert.deepEqual(words.map(word => [word[1], word[2]]), measuredWords.map(word => [number(word.origin.x), word.text]))
assert.equal(words.length, 5)
const styled = render_element(new Text({ children: [
  'plain words ', new Span({ color: 'red', children: 'red words' }), ' tail words',
] }), { fonts, text_mode: 'live' })
assert.equal((styled.svg.match(/<text /g) ?? []).length, 3)
assert.equal((styled.svg.match(/<tspan /g) ?? []).length, 6)
assert.equal((styled.svg.match(/fill="red"/g) ?? []).length, 1)
const precision = render_svg(make_fragment({ size: { width: 100, height: 30 }, draw: [
  draw_text('<&', make_point(1 / 3, 20), 10, { family: 'Face', size: 12, color: false }, { fill: 'red' }, null, 'start'),
  draw_text('next', make_point(17 / 3, 20), 10, { family: 'Face', size: 12, color: false }, { fill: 'red' }, null, 'start'),
] }), { precision: 3 })
assert.match(precision, /<tspan x="0.333">&lt;&amp;<\/tspan><tspan x="5.667">next<\/tspan>/)
console.log('ok - live SVG runs share typography while preserving line breaks, word positions, paint, opacity and escaping')

const pre = new Text({ whitespace: 'pre', font_family: 'IBM Plex Mono', children: ' a  b\t\n c ' })
const prePaths = layout_element(pre, { fonts })
const preLive = layout_element(pre, { fonts, text_mode: 'live' })
assert.deepEqual(geometry(preLive.fragment), geometry(prePaths.fragment))
const preSvg = render_svg(preLive.fragment)
assert.match(preSvg, /^<svg [^>]*xml:space="preserve"/)
assert.equal((preSvg.match(/xml:space=/g) ?? []).length, 1)
assert.ok(drawings(preLive.fragment).some(draw => draw.kind === 'text' && /\s/.test(draw.text)))
for (const paint of [{ color: 'none' }, { opacity: 0 }]) {
  const hidden = new Text({ ...paint, children: 'invisible' })
  assert.deepEqual(geometry(layout_element(hidden, { fonts, text_mode: 'live' }).fragment),
    geometry(layout_element(hidden, { fonts }).fragment))
}

// A pass must not reuse drawings made for a previous mode, and omitted mode
// restores the public default even after a live render with that same pass.
const pass = new LayoutPass(), text = new Text({ children: 'switch modes' })
assert.match(render_element(text, { pass, text_mode: 'live' }).svg, /<text /)
assert.doesNotMatch(render_element(text, { pass }).svg, /<text /)
assert.match(render_element(text, { pass, text_mode: 'live' }).svg, /<text /)
assert.throws(() => render_element(text, { text_mode: 'invalid' as any }), /text_mode/)
console.log('ok - live text preserves preformatted whitespace and reused passes respect each render mode')

const regular = readFileSync(new URL('../src/fonts/IBMPlexSans-Regular.ttf', import.meta.url))
fonts.register('Fallback Sans', regular, { fallback: true })
fonts.register('Real Italic', regular, { style: 'italic' })
fonts.register('Emoji', color_font([[0x1f600, 1200]]), { fallback: true })
const mixed = render_element(new Text({ font_family: 'IBM Plex Mono', children: 'aΩ😀' }), { fonts, text_mode: 'live' })
const mixedDraws = drawings(mixed.fragment).filter(draw => draw.kind === 'text')
assert.deepEqual(mixedDraws.map(draw => draw.text), ['a', 'Ω', '😀'])
assert.deepEqual(mixedDraws.map(draw => draw.font_family), ['IBM Plex Mono', 'Fallback Sans', 'Noto Color Emoji'])
const italic = render_element(new Text({ font_family: 'Real Italic', font_style: 'italic', children: 'face' }), { fonts, text_mode: 'live' })
assert.match(italic.svg, /font-style="italic"/)
assert.doesNotMatch(italic.svg, /oblique/)
// Providers without browser face metadata retain their measured outlines.
const custom: FontProvider = { resolve(family, weight, style) {
  const { face, ...font } = fonts.resolve(family, weight, style)
  return font
} }
assert.doesNotMatch(render_element(text, { fonts: custom, text_mode: 'live' }).svg, /<text /)
console.log('ok - fallback runs carry their actual face; color emoji and custom outline-only providers still work')

const sources = fonts.font_sources()
assert.ok(!sources.some(source => source.family === 'Noto Color Emoji'))
const source = sources.find(source => source.family === 'Fallback Sans')!
assert.ok(source.source instanceof Uint8Array)
assert.deepEqual(source.source, new Uint8Array(regular))
source.source.fill(0)
assert.deepEqual(fonts.font_sources().find(face => face.family === source.family)!.source, new Uint8Array(regular))
const url = sources.find(source => source.family === 'IBM Plex Sans')!.source as URL
url.pathname = '/changed.ttf'
assert.notEqual((fonts.font_sources()[0].source as URL).pathname, url.pathname)
console.log('ok - font sources expose isolated snapshots and omit the bundled metrics-only emoji font')

const draw = draw_text('style', make_point(2, 4), 10,
  { family: 'Face', size: 12, weight: 700, style: 'italic', oblique: false, color: false }, { fill: 'red' }, make_rect(1, 2, 3, 4), 'start')
assert.deepEqual(copy_drawing({ ...draw }), draw)
for (const font of [{ weight: 0 }, { weight: NaN }, { style: 'wrong' }, { oblique: 'yes' }]) {
  assert.throws(() => draw_text('bad', make_point(), 1, { family: 'Face', size: 12, ...font } as any,
    { fill: 'red' }, null))
}
console.log('ok - text drawing copies preserve typography and validate host font settings')
