import assert from 'node:assert/strict'
import { Text, Span, TextBox, TextFigure, TitleBox, Bullets, Box, Rect, Anchor,
  Element, LayoutPass, Fonts, px, em, make_request, exact, available, make_fragment,
  shape_size, draw_rect, make_rect, resolve_style, render_svg } from '../src'
import type { ElementProps, LayoutQuery, FontProvider, Fragment } from '../src'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
const descendants = (f: Fragment): Fragment[] => [f, ...f.children.flatMap(c => descendants(c.fragment))]
class Inline extends Element<ElementProps> {
  static layout(_props: ElementProps, query: LayoutQuery) {
    const size = shape_size(query.request, query.sizing)
    return make_fragment({ size, guides: { baseline: size.height * 0.75 }, label: 'item',
      draw: [draw_rect(make_rect(0, 0, size.width, size.height),
        { fill: query.style.color, stroke: 'none', stroke_width: 0 })] })
  }
}

const tests = {
  'inline objects are indivisible and share Unicode breaks with adjacent punctuation and spaces'() {
    const pass = new LayoutPass(), item = new Inline({ width: px(30), height: px(20) })
    const source = new Text({ children: ['Before ', item, ', after'] })
    const natural = pass.layout(source)
    assert.equal(natural.label, 'Before item, after')
    assert.equal(pass.layout(source, make_request({ width: exact(natural.size.width) })).children.length, 1)
    assert.equal(pass.layout(source, make_request({ width: exact(natural.size.width - 1e-9) })).children.length, 2)
    const narrow = pass.layout(source, make_request({ width: exact(1) }))
    assert.equal(narrow.children.length, 3)
    assert.deepEqual(narrow.children[1].fragment.children.map(c => c.fragment.name), ['Inline', 'Run'])
    assert.ok(narrow.overflow.right > 29)
    const joined = pass.layout(new Text({ children: ['a\u00a0', item, '\u00a0b'] }), make_request({ width: exact(1) }))
    assert.equal(joined.children.length, 1)
    const conditional = pass.layout(new Text({ children: [false, ['  a ', null, item, '\r'], '\nb  '] }))
    assert.equal(conditional.label, 'a item\nb')
    const tabs = pass.layout(new Text({ children: ['a', item, '\tb'], whitespace: 'pre' }))
    assert.equal(tabs.label, 'aitem  b')
  },

  'spans style inline objects before measurement and each line grows around their baseline'() {
    const pass = new LayoutPass()
    const item = new Inline({ width: em(2), height: em(3) })
    const source = new Text({ children: ['a ', new Span({ font_size: em(2), color: '#c42', children: item }), '\nb'] })
    const result = pass.layout(source)
    const line = result.children[0].fragment
    const placement = line.children.find(c => c.fragment.name === 'Inline')!
    near(placement.fragment.size.width, 64)
    near(placement.fragment.size.height, 96)
    near(line.guides.baseline!, placement.offset.y + placement.fragment.guides.baseline!)
    near(line.size.height, 96)
    near(result.children[1].fragment.size.height, 19.2)
    assert.ok(render_svg(result).includes('#c42'))
    const bare = pass.layout(new Text({ children: new Rect({ width: px(10), height: px(30) }) }))
    const rect = bare.children[0].fragment.children[0]
    near(bare.guides.baseline!, rect.offset.y + rect.fragment.size.height)
  },

  'element reference sizes update during reflow without reshaping prepared prose'() {
    const fonts = new Fonts()
    let shaped = 0
    const provider: FontProvider = { resolve(family, weight, style) {
      const font = fonts.resolve(family, weight, style)
      return { ...font, shape(text) { shaped++; return font.shape(text) } }
    } }
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } })
    const source = new Text({ children: ['before ', new Rect({ width: 0.5, height: px(10) }), ' after'] })
    assert.throws(() => pass.layout(source, make_request({ width: available(200) })), /reference/)
    const first = pass.layout(source, make_request({ width: exact(200) })), count = shaped
    const second = pass.layout(source, make_request({ width: exact(80) }))
    near(descendants(first).find(f => f.name === 'Rect')!.size.width, 100)
    near(descendants(second).find(f => f.name === 'Rect')!.size.width, 40)
    assert.equal(shaped, count)
    assert.equal(pass.layout(source, make_request({ width: exact(200) })), first)
  },

  'inline ink overhang remains overflow and placements keep source painting order'() {
    const pass = new LayoutPass()
    const item = new Anchor({ children: new Rect({ width: px(40), height: px(80), fill: 'red' }) })
    const source = new Text({ children: ['a', item, 'b'] })
    const natural = pass.layout(source)
    near(natural.size.height, 19.2)
    assert.ok(natural.overflow.top > 0 && natural.overflow.bottom > 0)
    assert.deepEqual(natural.children[0].fragment.children.map(c => c.fragment.name), ['Run', 'Anchor', 'Run'])
    const tiny = pass.layout(source, make_request({ width: exact(0), height: exact(0) }))
    assert.equal(tiny.size.width, 0); assert.equal(tiny.size.height, 0)
    assert.ok(tiny.overflow.right > 0 && tiny.overflow.bottom > 0)
    near(descendants(tiny).find(f => f.name === 'Rect')!.size.height, 80)
  },

  'document text helpers accept mixed inline content while preserving a sole block'() {
    const pass = new LayoutPass(), item = new Inline({ width: px(30), height: px(20) })
    const mixed = ['Before ', new Span({ children: 'bold ', font_weight: 700 }), item, ' after']
    for (const source of [new TextBox({ children: mixed }), new Bullets({ items: [mixed] }),
      new TextFigure({ caption: mixed, children: new Rect({ width: px(40), height: px(20) }) }),
      new TitleBox({ title: mixed, children: new Text({ text: 'Body' }) })]) {
      const result = pass.layout(source, make_request({ width: exact(180) }))
      assert.ok(descendants(result).some(f => f.name === 'Text' && f.label === 'Before bold item after'))
    }
    const block = new Box({ grow: 1, children: new Text({ text: 'Block' }) })
    assert.equal(new TextBox({ children: ['\n', false, block] }).props.children, block)
    assert.throws(() => new TextBox({ children: [block, block] }), /one content element/)
    const context = { style: resolve_style({ color: '#c42' }) }
    assert.ok(render_svg(pass.layout(new TextBox({ children: mixed }), make_request(), context)).includes('#c42'))
  },
}

for (const [name, check] of Object.entries(tests)) { check(); console.log(`ok - ${name}`) }
console.log(`${Object.keys(tests).length} inline composition checks passed.`)
