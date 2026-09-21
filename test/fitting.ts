import assert from 'node:assert/strict'
import {
  Box, Frame, Group, Text, TextBox, HStack, Node, Square, LayoutPass,
  available, exact, make_request, make_fragment, make_size, make_insets,
  define_element, finish_size, px, em, evaluate, render_svg,
} from '../src/index'
import { Fixed } from './fixtures/leaves'

const offer = (width: number, height?: number) => make_request({ width: available(width),
  height: height === undefined ? undefined : available(height) })
const fixed = { content_width: px(200), content_height: px(100), fill: 'teal' }

// Removed spellings must fail for typed callers as well as evaluated JSX.
if (false) {
  // @ts-expect-error Content sizing is the default, not a width keyword.
  new Box({ width: 'hug' })
  // @ts-expect-error Content sizing is the default, not a height keyword.
  new Box({ height: 'hug' })
  // @ts-expect-error Scaling belongs to fit, not width or height.
  new Box({ width: 'fit' })
  // @ts-expect-error Shrink-only fitting uses true, without a string alias.
  new Box({ fit: 'shrink' })
}

const tests: Record<string, () => void> = {
  'fit is a shared, non-inherited sizing policy for built-in and custom elements'() {
    const pass = new LayoutPass(), source = new Fixed({ ...fixed, fit: true })
    const snapshot = JSON.stringify(source)
    for (const [width, height, expected, scale] of [
      [640, 480, [200, 100], 1], [100, 100, [100, 50], 0.5],
      [100, 25, [50, 25], 0.25], [0, 100, [0, 0], 0],
    ] as const) {
      const request = offer(width, height)
      const result = pass.layout(source, request)
      assert.deepEqual(result.size, make_size(...expected))
      assert.equal(result.guides.baseline, 80 * scale)
      assert.deepEqual(result.overflow, make_insets())
      assert.equal(result.name, 'Fixed')
      assert.equal(pass.layout(source, request), result)
      if (scale === 1) assert.equal(result.children.length, 0)
      else assert.deepEqual(result.children[0].transform, [scale, 0, 0, scale, 0, 0])
    }
    assert.equal(JSON.stringify(source), snapshot)
    const raw = pass.layout(new Fixed({ ...fixed, fit: false }), offer(100))
    assert.deepEqual(raw.size, make_size(200, 100))
    const box = pass.layout(new Box({ fit: true, padding: px(10), children: new Fixed(fixed) }), offer(110))
    assert.deepEqual(box.size, make_size(110, 60))
    assert.deepEqual(box.children[0].fragment.children[0].fragment.size, make_size(200, 100))
  },

  'authored canvas dimensions establish the source while external offers bound the fitted result'() {
    const source = new Group({ fit: true, width: px(200), height: px(100), children: new Text({ text: 'Label' }) })
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(source).size, make_size(200, 100))
    const small = pass.layout(source, offer(100, 100))
    assert.deepEqual(small.size, make_size(100, 50))
    assert.deepEqual(small.children[0].fragment.size, make_size(200, 100))
    assert.deepEqual(pass.layout(source, offer(640, 480)).size, make_size(200, 100))
    const constrained = pass.layout(new Group({ ...source.props, max_width: px(80), max_height: px(30) }))
    assert.deepEqual(constrained.size, make_size(60, 30))
  },

  'contain enlarges, cover crops, and exact allocations can position the scaled drawing'() {
    const pass = new LayoutPass()
    const contain = pass.layout(new Fixed({ ...fixed, fit: 'contain' }), offer(100, 100))
    assert.deepEqual(contain.size, make_size(100, 100))
    assert.deepEqual(contain.children[0].offset, { x: 0, y: 25 })
    assert.equal(contain.guides.baseline, 65)
    assert.deepEqual(pass.layout(new Fixed({ ...fixed, fit: 'contain' }), offer(400)).size, make_size(400, 200))
    const cover = pass.layout(new Fixed({ ...fixed, fit: 'cover' }), offer(100, 100))
    assert.deepEqual(cover.children[0].offset, { x: -50, y: 0 })
    assert.deepEqual(cover.ink, { x: 0, y: 0, width: 100, height: 100 })
    assert.equal(cover.overflow.left, 50)
    const exact_request = make_request({ width: exact(640), height: exact(480) })
    const small = pass.layout(new Fixed({ ...fixed, fit: true }), exact_request)
    assert.deepEqual(small.size, make_size(640, 480))
    assert.deepEqual(small.children[0].offset, { x: 220, y: 190 })
    const start = pass.layout(new Fixed({ ...fixed, fit: true, fit_align: 'start' }), exact_request)
    assert.deepEqual(start.children[0].offset, { x: 0, y: 0 })
    const filled = pass.layout(new Fixed({ ...fixed, fit: true, width: 'fill' }), offer(640, 480))
    assert.deepEqual(filled.size, make_size(640, 100))
    assert.deepEqual(pass.layout(new Box({ fit: true }), offer(200, 100)).size, make_size())
  },

  'omitted dimensions reflow naturally and alignment opts out of parent fill on either axis'() {
    const pass = new LayoutPass(), text = 'Several words make a long label that should wrap.'
    const raw = pass.layout(new Text({ text }), offer(100))
    const fitted = pass.layout(new Text({ text, fit: true }), offer(100))
    assert.ok(raw.size.height > fitted.size.height)
    assert.ok(fitted.children[0].transform![0] < 1)
    const height = pass.layout(new HStack({ height: px(80), align: 'fill', children: [
      new Fixed({ align_self: 'start' }), new Fixed({ height: 'fill' }),
    ] }))
    assert.deepEqual(height.children.map(child => child.fragment.size.height), [20, 80])
    assert.deepEqual(pass.layout(new Fixed({ height: 'fill' }), offer(300, 80)).size, make_size(96, 80))
    const box = pass.layout(new TextBox({ fit: true, children: 'Short' }), offer(640, 480))
    assert.ok(box.size.width < 100)
    assert.equal(box.children[0].fragment.name, 'Text')
  },

  'fitting retains math classes and scales metrics, guides, strokes, and reserved outsets'() {
    const MathLeaf = define_element('MathLeaf', (_, query) => make_fragment({
      size: finish_size(make_size(200, 100), query.request, query.sizing),
      guides: { baseline: 80, math_axis: 60 }, outset: make_insets({ top: 10 }),
      math: { advance: 190, italic: 4, skew: 2, left: 'mord', right: 'mrel', nucleus: 'character' },
    }))
    const result = new LayoutPass().layout(new MathLeaf({ fit: true }), offer(100))
    assert.deepEqual(result.guides, { baseline: 40, math_axis: 30 })
    assert.deepEqual(result.math, { advance: 95, italic: 2, skew: 1,
      left: 'mord', right: 'mrel', nucleus: 'character' })
    assert.deepEqual(result.outset, make_insets({ top: 5 }))
    const frame = new LayoutPass().layout(new Frame({ fit: true, padding: em(1), border_width: px(2),
      children: new Fixed(fixed) }), offer(118))
    assert.equal(frame.children[0].transform![0], 0.5)
    assert.match(render_svg(frame), /scale|matrix/)
    const square = new LayoutPass().layout(new Square({ fit: 'contain', width: px(20), stroke_width: px(2) }), offer(40))
    assert.equal(square.children[0].fragment.draw[0].stroke_width, 2)
    assert.equal(square.children[0].transform![0], 2)
  },

  'fitted identified elements publish one transformed connection boundary'() {
    const result = new LayoutPass().layout(new Node({ fit: 'contain', id: 'node', border_radius: px(4),
      width: px(200), height: px(100), text: 'Node' }), offer(100, 100))
    assert.deepEqual(result.connection!.boundary, { x: 0, y: 25, width: 100, height: 50,
      radius: { x: 2, y: 2 } })
    assert.equal(result.children[0].fragment.connection, undefined)
    const custom = new LayoutPass().layout(new Fixed({ ...fixed, fit: true, id: 'fixed' }), offer(100))
    assert.deepEqual(custom.connection!.boundary, { x: 0, y: 0, width: 100, height: 50 })
  },

  'fit JSX works without wrapper elements and invalid policies fail clearly'() {
    const source = evaluate('<Box fit><Text>Fitted content</Text></Box>')
    const result = new LayoutPass().layout(source, offer(30))
    assert.ok(Math.abs(result.size.width - 30) < 1e-9)
    assert.equal(result.name, 'Box')
    assert.throws(() => new LayoutPass().layout(evaluate('<Text fit="stretch">No</Text>')), /fit must be/)
    assert.throws(() => new LayoutPass().layout(evaluate('<Text fit fit-align="fill">No</Text>')), /never stretches/)
    for (const axis of ['width', 'height']) for (const value of ['fit', 'hug']) {
      assert.throws(() => new LayoutPass().layout(evaluate(`<Text ${axis}="${value}">Old</Text>`)), /omit the dimension/)
    }
    assert.throws(() => evaluate('<Fit><Text>Old</Text></Fit>'), /Fit/)
    assert.throws(() => new LayoutPass().layout(evaluate('<Text fit="scale_down">Old</Text>')), /fit must be/)
    assert.throws(() => new LayoutPass().layout(evaluate('<Text fit="shrink">Old</Text>')), /fit must be/)
  },

  'changing target bounds reuses the natural drawing without caching across styles or references'() {
    let layouts = 0
    const Probe = define_element('Probe', (_, query) => {
      layouts++
      return make_fragment({ size: finish_size(make_size(query.style.font_size * 20, 100),
        query.request, query.sizing) })
    })
    const pass = new LayoutPass(), source = new Probe({ fit: true })
    for (const width of [320, 200, 100, 50, 0]) {
      assert.equal(pass.layout(source, offer(width)).size.width, width)
    }
    assert.equal(layouts, 1)
    pass.layout(source, offer(200), { reference: { width: 400 } })
    assert.equal(layouts, 2)
    pass.set_resource('version-test', {}, 1)
    pass.layout(source, offer(200))
    assert.equal(layouts, 3)
    pass.layout(new Box({ font_size: px(32), children: source }), offer(200))
    assert.equal(layouts, 4)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} fitting checks passed.`)
