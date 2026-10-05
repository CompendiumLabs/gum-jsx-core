import assert from 'node:assert/strict'
import {
  Box, Fonts, LayoutPass, Rect, Span, Text, em, px, evaluate, layout_element,
  render_svg, resolve_style, drawing_ink,
} from '../src'
import type { Drawing, Fragment, StyleSpec } from '../src'
import { color_font } from './fixtures/color_font'

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

// Follow the renderer's paint order through the result tree.
function drawings(fragment: Fragment): Drawing[] {
  return [...fragment.draw, ...fragment.children.flatMap(child => drawings(child.fragment))]
}

const tests: Record<string, () => void> = {
  'halos grow ink and overflow without changing advances, guides, or wrapping'() {
    const pass = new LayoutPass()
    const props = { children: 'AV office\nJgy text', font_size: px(24),
      line_height: px(8), width: px(100), justify: 'end' as const }
    const plain = pass.layout(new Text(props))
    const halo = pass.layout(new Text({ ...props, halo_color: 'white', halo_width: px(3) }))
    assert.deepEqual(halo.size, plain.size)
    assert.deepEqual(halo.guides, plain.guides)
    assert.deepEqual(halo.children, plain.children)
    assert.equal(halo.label, plain.label)
    near(halo.ink!.x, plain.ink!.x - 3)
    near(halo.ink!.y, plain.ink!.y - 3)
    near(halo.ink!.width, plain.ink!.width + 6)
    near(halo.ink!.height, plain.ink!.height + 6)
    near(halo.overflow.top, plain.overflow.top + 3)
    near(halo.overflow.bottom, plain.overflow.bottom + 3)
    assert.ok(halo.overflow.right > plain.overflow.right)
  },

  'all halos precede foreground spans, lines, and inline elements'() {
    const pass = new LayoutPass()
    const props = { width: px(120), justify: 0.75, line_height: px(2), children: [
      'AV', new Span({ color: 'red', children: 'office' }), '\n',
      new Rect({ width: px(9), height: px(8), fill: 'blue' }), 'g',
    ] }
    const plain = pass.layout(new Text(props))
    const halo = pass.layout(new Text({ ...props, halo_color: 'white', halo_width: px(4),
      stroke: 'purple', stroke_width: px(8), stroke_dasharray: px(3) }))
    const ink = drawings(halo)
    assert.equal(halo.draw.length, 3)
    assert.ok(ink.slice(0, 3).every(draw => draw.kind === 'path'
      && draw.fill === 'none' && draw.stroke === 'white' && draw.stroke_width === 8
      && draw.stroke_linejoin === 'round' && draw.stroke_linecap === 'round'
      && draw.stroke_dasharray?.length === 0))
    assert.ok(ink.slice(3).every(draw => draw.stroke !== 'white'))
    // Line justification and inline offsets are included in halo coordinates.
    const line = plain.children[1], run = line.fragment.children[1]
    const foreground = run.fragment.draw[0], outline = halo.draw[2]
    assert.ok(foreground.kind === 'path' && outline.kind === 'path')
    near(outline.bounds!.x, foreground.bounds!.x + line.offset.x + run.offset.x)
    near(outline.bounds!.y, foreground.bounds!.y + line.offset.y + run.offset.y)
    near(outline.bounds!.width, foreground.bounds!.width)
    near(outline.bounds!.height, foreground.bounds!.height)
    const svg = render_svg(halo)
    assert.ok(svg.lastIndexOf('stroke="white"') < svg.indexOf('fill="#000000"'))
  },

  'halo styles inherit, follow local font size, and support explicit resets'() {
    const pass = new LayoutPass()
    const style = resolve_style({ halo_color: 'white', font_size: px(20) })
    const fragment = pass.layout(new Text({ children: [
      'A', new Span({ font_size: em(2), children: 'B' }),
      new Span({ halo_color: 'none', children: 'C' }),
      new Span({ halo_width: 0, children: 'D' }),
      new Span({ halo_color: 'red', halo_width: px(3), children: 'E' }),
    ] }), undefined, { style })
    assert.deepEqual(fragment.draw.map(draw => [draw.stroke, draw.stroke_width]),
      [['white', 3.2], ['white', 6.4], ['red', 6]])
    const props = { children: 'units', font_size: px(20), halo_color: 'white' }
    const pixels = pass.layout(new Text({ ...props, halo_width: px(2) }))
    for (const halo_width of [em(0.1), 0.1, '10%', '0.1em', '2px'] as const) {
      assert.deepEqual(pass.layout(new Text({ ...props, halo_width })), pixels)
    }
    const theme = resolve_style({ halo_color: 'theme:foreground', theme: 'light' })
    assert.equal(resolve_style({ theme: 'dark' }, theme).halo_color, '#ffffff')
    assert.equal(resolve_style({}, { ...theme, halo_color: 'red' }).halo_color, 'red')
  },

  'disabled halos preserve output and invalid widths fail at the style boundary'() {
    const pass = new LayoutPass(), props = { children: 'unchanged' }
    const plain = pass.layout(new Text(props))
    for (const style of [{ halo_color: 'none' }, { halo_color: 'white', halo_width: 0 },
      { halo_width: px(3) }]) {
      assert.deepEqual(pass.layout(new Text({ ...props, ...style })), plain)
    }
    for (const children of ['', ' ', '\n', '   \n']) {
      const fragment = pass.layout(new Text({ children, halo_color: 'white' }))
      assert.equal(fragment.draw.length, 0)
      assert.equal(fragment.ink, null)
    }
    const zero = pass.layout(new Text({ ...props, font_size: 0, halo_color: 'white', halo_width: px(3) }))
    assert.equal(zero.draw.length, 0)
    assert.equal(zero.ink, null)
    for (const halo_width of [-1, px(-1), '-1em', '-2%', NaN, Infinity] as const) {
      assert.throws(() => resolve_style({ halo_width }), /halo_width/)
    }
    assert.throws(() => resolve_style({ halo_color: 42 } as unknown as StyleSpec), /paint/i)
    assert.throws(() => resolve_style({ halo_color: 'theme:invalid' }), /theme color/)
  },

  'live and mixed text retain one selectable foreground and the same halo outlines'() {
    const element = new Text({ children: ['AV ', new Span({ font_style: 'italic', children: 'office' })],
      halo_color: 'white', halo_width: px(2) })
    const paths = layout_element(element).fragment
    const halos = drawings(paths).filter(draw => draw.stroke === 'white')
    for (const text_mode of ['live', 'mixed'] as const) {
      const live = layout_element(element, { text_mode }).fragment
      assert.deepEqual(live.size, paths.size)
      assert.deepEqual(live.ink, paths.ink)
      assert.deepEqual(drawings(live).filter(draw => draw.stroke === 'white'), halos)
      const text = drawings(live).filter(draw => draw.kind === 'text')
      assert.equal(text.map(draw => draw.text).join(''), 'AV office')
      const svg = render_svg(live)
      assert.ok(svg.lastIndexOf('stroke="white"') < svg.indexOf('<text '))
      assert.doesNotMatch(svg, /aria-label=/)
    }
  },

  'halo bounds respect clipping, fitting, and existing per-drawing opacity'() {
    const text = new Text({ children: 'Jgy', font_size: px(24), halo_color: 'white',
      halo_width: px(3), opacity: 0.4 })
    const pass = new LayoutPass(), fragment = pass.layout(text)
    assert.ok(drawings(fragment).every(draw => draw.opacity === 0.4))
    assert.deepEqual(drawing_ink(fragment.draw[0]), fragment.ink)
    const clipped = pass.layout(new Box({ width: px(4), height: px(4), clip: true, children: text }))
    assert.ok(clipped.ink!.x >= 0 && clipped.ink!.y >= 0)
    assert.ok(clipped.ink!.width <= 4 && clipped.ink!.height <= 4)
    const fitted = layout_element(new Box({ width: px(100), height: px(60), fit: true, children: text }),
      { wrap: { max_width: px(50) } }).fragment
    assert.equal(fitted.size.width, 50)
    assert.ok(drawings(fitted).some(draw => draw.stroke === 'white'))
    const hidden = pass.layout(new Text({ ...text.props, opacity: 0 }))
    assert.equal(hidden.ink, null)
  },

  'generated label scopes receive halos and color glyphs stay unchanged'() {
    const pass = new LayoutPass()
    const plot = pass.layout(evaluate(`
      <Plot width={px(300)} height={px(200)} title="Title"
        label-halo-color={white} title-halo-color={white} title-halo-width={px(2)} />
    `))
    assert.ok(drawings(plot).some(draw => draw.stroke === '#ffffff' && draw.stroke_width === 4))
    assert.ok(drawings(plot).some(draw => draw.stroke === '#ffffff' && draw.stroke_width === 2.56))
    const fonts = new Fonts()
    fonts.register('Emoji', color_font([[0x1f600, 1200]]), { fallback: true })
    const plain = layout_element(new Text({ children: '😀' }), { fonts }).fragment
    const halo = layout_element(new Text({ children: '😀', halo_color: 'white' }), { fonts }).fragment
    assert.deepEqual(halo, plain)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
