import assert from 'node:assert/strict'
import {
  Group, Svg, Box, Rect, Circle, Text, Fonts, LayoutPass, define_element, evaluate,
  px, em, available, exact, make_request, make_size, make_fragment, finish_size, render_svg,
} from '../src/index'
import type { FontProvider } from '../src/index'

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

const tests: Record<string, () => void> = {
  'Group adopts a viewport before measuring children and Svg hugs an explicit canvas'() {
    const pass = new LayoutPass()
    const root = pass.layout(evaluate(`<Svg width={px(200)} height={px(100)}>
      <Group><Rect fill="teal" stroke="none"/></Group>
    </Svg>`))
    const group = root.children[0].fragment, rect = group.children[0].fragment
    assert.deepEqual(group.size, { width: 200, height: 100 })
    assert.deepEqual(rect.size, group.size)
    assert.deepEqual(pass.stats, { queries: 3, layouts: 3, hits: 0 })
    const natural = pass.layout(new Svg({ children: new Group({ width: px(200), height: px(100) }) }))
    assert.deepEqual(natural.size, group.size)
    assert.equal(natural.ink, null)
    assert.ok(!render_svg(root).includes('translate(0 0)'))
  },

  'fractional positions and child regions use the whole canvas and anchors use allocated bounds'() {
    const root = new LayoutPass().layout(evaluate(`<Group width={px(200)} height={px(100)}>
      <Rect x={0.25} y={0.25} width={0.5} height={0.5} stroke="none"/>
      <Circle x={0.75} y={0.5} anchor="center" width={px(20)} stroke="none"/>
      <Rect x={1} y={1} anchor="end" width={px(30)} height={px(10)} stroke="none"/>
    </Group>`))
    const [rect, circle, corner] = root.children
    assert.deepEqual(rect.offset, { x: 50, y: 25 })
    assert.deepEqual(rect.fragment.size, { width: 100, height: 50 })
    assert.deepEqual(circle.offset, { x: 140, y: 40 })
    assert.deepEqual(circle.fragment.size, { width: 20, height: 20 })
    assert.deepEqual(corner.offset, { x: 170, y: 90 })
  },

  'canvas aspect derives one axis while exact dimensions win and pixel strokes stay fixed'() {
    const source = evaluate(`<Svg width={px(400)}><Group aspect={2}>
      <Circle x={0.25} y={0.5} anchor="center" width={em(2)} stroke_width={px(2)}/>
      <Rect x={0.5} y={0.25} width={0.5} height={0.5} stroke_width={px(2)}/>
    </Group></Svg>`)
    const before = JSON.stringify(source), pass = new LayoutPass()
    const first = pass.layout(source)
    const second = pass.layout(source, make_request({ width: exact(640) }))
    assert.deepEqual(first.size, { width: 400, height: 200 })
    assert.deepEqual(second.size, { width: 640, height: 320 })
    const a = first.children[0].fragment, b = second.children[0].fragment
    assert.deepEqual(a.children[0].fragment.size, b.children[0].fragment.size)
    assert.deepEqual(b.children[0].offset, { x: 144, y: 144 })
    assert.deepEqual(b.children[1].fragment.size, { width: 320, height: 160 })
    assert.equal(b.children[1].fragment.draw[0].stroke_width, 2)
    assert.equal(JSON.stringify(source), before)
    const group = new Group({ aspect: 2 })
    assert.deepEqual(pass.layout(group, make_request({ width: available(300), height: available(100) })).size,
      { width: 200, height: 100 })
    assert.deepEqual(pass.layout(group, make_request({ width: exact(300), height: exact(100) })).size,
      { width: 300, height: 100 })
    assert.deepEqual(pass.layout(new Group({ height: px(90), aspect: 3 })).size,
      { width: 270, height: 90 })
  },

  'em positions use each child font independently of the group and numeric anchors are dimensionless'() {
    const group = new LayoutPass().layout(new Group({ width: px(200), height: px(100), font_size: px(10),
      children: new Rect({ x: em(1), y: em(2), anchor: { x: 'end', y: 0.25 }, font_size: em(2),
        width: em(2), height: em(1), stroke_width: em(0.1) }) }))
    const child = group.children[0]
    assert.deepEqual(child.fragment.size, { width: 40, height: 20 })
    assert.deepEqual(child.offset, { x: -20, y: 35 })
    assert.equal(child.fragment.draw[0].stroke_width, 2)
  },

  'nested canvases establish local references and reuse a source at different positions'() {
    const leaf = new Rect({ x: 0.5, y: 0.25, width: 0.5, height: 0.5, fill: 'teal', stroke: 'none' })
    const pass = new LayoutPass()
    const root = pass.layout(new Group({ width: px(200), height: px(100), children: [
      new Group({ width: 0.5, height: 1, children: leaf }),
      new Group({ x: 0.5, width: 0.5, height: 1, children: leaf }),
    ] }))
    const [a, b] = root.children
    assert.deepEqual(a.offset, { x: 0, y: 0 })
    assert.deepEqual(b.offset, { x: 100, y: 0 })
    assert.deepEqual(a.fragment.size, { width: 100, height: 100 })
    assert.deepEqual(a.fragment.children[0].fragment.size, { width: 50, height: 50 })
    assert.deepEqual(a.fragment.children[0].offset, { x: 50, y: 25 })
    assert.equal(a.fragment.children[0].fragment, b.fragment.children[0].fragment)
    assert.deepEqual(pass.stats, { queries: 5, layouts: 4, hits: 1 })
  },

  'positions and anchors do not change child offers or introduce policy in other containers'() {
    let calls = 0
    const Probe = define_element('Probe', (_, q) => {
      calls++
      assert.deepEqual(q.request, make_request({ width: available(200), height: available(100) }))
      assert.deepEqual(q.measure.reference, { width: 200, height: 100 })
      return make_fragment({ size: finish_size(make_size(24, 12), q.request, q.sizing) })
    })
    const pass = new LayoutPass()
    const group = pass.layout(new Group({ width: px(200), height: px(100), children: [
      new Probe({ x: px(-20) }), new Probe({ x: px(250), y: px(150), anchor: 'end' }),
    ] }))
    assert.equal(calls, 2)
    assert.deepEqual(group.children.map(child => child.offset), [{ x: -20, y: 0 }, { x: 226, y: 138 }])
    const box = pass.layout(new Box({ width: px(100), height: px(100), children:
      new Rect({ x: 0.5, y: 0.5, anchor: 'center', width: px(20), height: px(10) }) }))
    assert.deepEqual(box.children[0].offset, { x: 0, y: 0 })
  },

  'positioned paragraphs reflow in sized regions with unchanged font measurements and local guides'() {
    const fonts = new Fonts()
    let shapes = 0
    const provider: FontProvider = { resolve(family, weight, style) {
      const font = fonts.resolve(family, weight, style)
      return { ...font, shape(text) { shapes++; return font.shape(text); } }
    } }
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } })
    const source = new Group({ width: px(400), height: px(300), children: new Text({
      x: 0.5, y: 0.5, anchor: 'center', width: 0.5, font_size: px(18),
      children: 'A paragraph lives in a positioned region. Its words reflow when that region changes width.',
    }) })
    const wide = pass.layout(source), count = shapes
    const narrow = pass.layout(source, make_request({ width: exact(200) }))
    const a = wide.children[0], b = narrow.children[0]
    assert.equal(a.fragment.size.width, 200)
    assert.equal(b.fragment.size.width, 100)
    assert.ok(b.fragment.children.length > a.fragment.children.length)
    assert.equal(shapes, count)
    near(b.offset.x, 50)
    near(b.offset.y, 150 - b.fragment.size.height / 2)
    near(b.fragment.size.height, b.fragment.children.length * 21.6)
    assert.deepEqual(narrow.guides, {})
    assert.ok(b.fragment.guides.baseline! > 0)
    assert.equal(b.transform, undefined)
  },

  'canvas clipping hides ink but retains positioned overflow and source paint order'() {
    const pass = new LayoutPass()
    const leaf = new Rect({ x: px(-10), y: px(90), width: px(20), height: px(20),
      fill: 'teal', stroke: 'none' })
    const props = { width: px(100), height: px(100), children: leaf }
    const a = pass.layout(new Group(props)), b = pass.layout(new Group({ ...props, clip: true }))
    assert.equal(a.children[0].fragment, b.children[0].fragment)
    assert.deepEqual(a.ink, { x: -10, y: 90, width: 20, height: 20 })
    assert.deepEqual(b.ink, { x: 0, y: 90, width: 10, height: 10 })
    assert.deepEqual(a.overflow, { left: 10, top: 0, right: 0, bottom: 10 })
    assert.deepEqual(b.overflow, a.overflow)
    assert.match(render_svg(b), /clip-path="url\(#/)
    const layers = pass.layout(evaluate(`<Group width={px(100)} height={px(100)}>
      <Rect fill="red" stroke="none"/>{false}<><Rect x={0.25} width={0.5} fill="blue" stroke="none"/></>
    </Group>`))
    const svg = render_svg(layers)
    assert.ok(svg.indexOf('fill="red"') < svg.indexOf('fill="blue"'))
    assert.equal(layers.children.length, 2)
  },

  'unknown canvas extents fail before measuring children and exact zero remains valid'() {
    const pass = new LayoutPass()
    let calls = 0
    const Probe = define_element('Probe', () => {
      calls++
      return make_fragment({ size: make_size(100, 100) })
    })
    for (const props of [{}, { width: px(100) }, { aspect: 2 }]) {
      assert.throws(() => pass.layout(new Group({ ...props, children: new Probe() })), /Group needs a finite/)
    }
    assert.equal(calls, 0)
    assert.throws(() => pass.layout(new Group()), /Group needs a finite width and height/)
    const zero = pass.layout(new Group({ width: px(0), height: px(0), children:
      new Rect({ x: 0.5, y: 0.5, anchor: 'center', width: 0.5, height: 0.5 }) }))
    assert.deepEqual(zero.size, make_size())
    assert.deepEqual(zero.children[0].fragment.size, make_size())
    assert.deepEqual(zero.children[0].offset, { x: 0, y: 0 })
    assert.equal(zero.ink, null)
    assert.throws(() => pass.layout(new Group({ width: px(100), height: px(100), children:
      new Rect({ x: NaN }) })), /Group\/Rect\[0\].x/)
    assert.throws(() => pass.layout(new Group({ width: px(100), height: px(100), children:
      new Rect({ anchor: { y: NaN } }) })), /Group\/Rect\[0\].anchor/)
    assert.throws(() => pass.layout(evaluate(`<Group width={px(100)} height={px(100)}>
      <Rect anchor="stretch"/>
    </Group>`)), /Group\/Rect\[0\].anchor/)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} group checks passed.`)
