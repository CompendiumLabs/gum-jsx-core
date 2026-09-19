import assert from 'node:assert/strict'
import {
  Svg, Box, Rect, Text, LayoutPass, define_element, make_fragment, make_size, make_rect,
  make_insets, draw_rect, render_element, render_svg, px, em, make_request, available, exact,
} from '../src/index'
import { Wrapping } from './fixtures/leaves'

const tests: Record<string, () => void> = {
  'viewport maxima shrink both dimensions uniformly, whichever axis limits the figure'() {
    const child = new Rect({ width: px(400), height: px(800), stroke: 'none' })
    for (const [bounds, size, scale] of [
      [{ max_width: px(100) }, { width: 100, height: 200 }, 0.25],
      [{ max_height: px(100) }, { width: 50, height: 100 }, 0.125],
      [{ max_width: px(200), max_height: px(100) }, { width: 50, height: 100 }, 0.125],
      [{ max_width: px(100), max_height: px(400) }, { width: 100, height: 200 }, 0.25],
    ] as const) {
      const source = new Svg({ ...bounds, children: child, background: 'white' })
      const before = JSON.stringify(source), pass = new LayoutPass()
      const fragment = pass.layout(source)
      assert.deepEqual(fragment.size, size)
      assert.deepEqual(fragment.ink, make_rect(0, 0, size.width, size.height))
      assert.deepEqual(fragment.overflow, make_insets())
      assert.deepEqual(fragment.children[0].transform, [scale, 0, 0, scale, 0, 0])
      assert.deepEqual(fragment.children[0].fragment.size, { width: 400, height: 800 })
      assert.equal(pass.layout(source), fragment)
      assert.equal(JSON.stringify(source), before)
      assert.equal(pass.stats.layouts, 2)
      assert.doesNotMatch(render_svg(fragment), /NaN|Infinity/)
    }
  },

  'bounded viewports reflow at the offered width before fitting height'() {
    const child = new Wrapping({ count: 30, font_size: px(10) })
    const flowed = render_element(child, { wrap: { max_width: px(60) } })
    assert.deepEqual(flowed.size, { width: 60, height: 50 })
    assert.equal(flowed.fragment.children[0].transform, undefined)
    const bounded = render_element(child, { wrap: { max_width: px(60), max_height: px(25) } })
    assert.deepEqual(bounded.size, { width: 30, height: 25 })
    assert.deepEqual(bounded.fragment.children[0].fragment, flowed.fragment.children[0].fragment)
    assert.deepEqual(bounded.fragment.children[0].transform, [0.5, 0, 0, 0.5, 0, 0])
    assert.equal(bounded.fragment.guides.baseline, 20)

    const text = new Text({ text: 'Reflow keeps these words on the same lines before fitting.', font_size: px(20) })
    const natural = render_element(text, { wrap: { max_width: px(120) } })
    const fitted = render_element(text, { wrap: { max_width: px(120), max_height: px(20) } })
    assert.ok(natural.size.height > 20)
    assert.deepEqual(fitted.fragment.children[0].fragment, natural.fragment.children[0].fragment)
    assert.equal(fitted.size.height, 20)
    assert.ok(fitted.size.width < natural.size.width)
  },

  'small figures hug, and available offers alone still allow natural height'() {
    const small = new Rect({ width: px(40), height: px(30) })
    const fitted = render_element(small, { wrap: { max_width: px(500), max_height: px(300) } })
    assert.deepEqual(fitted.size, { width: 40, height: 30 })
    assert.equal(fitted.fragment.children[0].transform, undefined)
    const tall = new Rect({ width: px(80), height: px(700), stroke: 'none' })
    const offered = render_element(tall, {
      request: make_request({ width: available(640), height: available(480) }),
    })
    assert.deepEqual(offered.size, { width: 80, height: 700 })
    assert.equal(offered.fragment.children[0].transform, undefined)
    const widthOnly = render_element(tall, { request: make_request({ width: exact(320) }) })
    assert.deepEqual(widthOnly.size, { width: 320, height: 700 })
    assert.equal(widthOnly.fragment.children[0].transform, undefined)
  },

  'exact axes retain their allocations and clipping, independent of viewport maxima'() {
    const child = new Rect({ width: px(400), height: px(800), stroke: 'none' })
    const wrap = { max_width: px(100), max_height: px(200) }
    const fixed = render_element(child, {
      wrap, request: make_request({ width: exact(300), height: exact(150) }),
    })
    assert.deepEqual(fixed.size, { width: 300, height: 150 })
    assert.equal(fixed.fragment.children[0].transform, undefined)
    assert.deepEqual(fixed.fragment.overflow, { left: 0, top: 0, right: 100, bottom: 650 })
    const width = render_element(child, { wrap, request: make_request({ width: exact(300) }) })
    assert.deepEqual(width.size, { width: 300, height: 200 })
    assert.deepEqual(width.fragment.children[0].transform, [0.25, 0, 0, 0.25, 0, 0])
  },

  'fitting includes reserved outsets and scales their offsets and guides'() {
    const Decorated = define_element('Decorated', () => make_fragment({
      size: make_size(200, 400), guides: { baseline: 320 },
      outset: make_insets({ left: 10, top: 20, right: 30, bottom: 40 }),
      draw: [draw_rect(make_rect(-10, -20, 240, 460), { fill: 'blue', stroke: 'none', stroke_width: 0 })],
    }))
    const { fragment } = render_element(new Decorated(), { wrap: { max_height: px(230) } })
    assert.deepEqual(fragment.size, { width: 120, height: 230 })
    assert.deepEqual(fragment.children[0].offset, { x: 5, y: 10 })
    assert.deepEqual(fragment.children[0].transform, [0.5, 0, 0, 0.5, 0, 0])
    assert.equal(fragment.guides.baseline, 170)
    assert.deepEqual(fragment.overflow, make_insets())
    assert.deepEqual(fragment.ink, make_rect(0, 0, 120, 230))
    assert.equal(fragment.outset, undefined)
  },

  'zero bounds stay finite, and own minima can reserve space around scaled content'() {
    const child = new Rect({ width: px(100), height: px(200), stroke: 'none' })
    const zero = render_element(child, { wrap: { max_height: px(0) } })
    assert.deepEqual(zero.size, make_size())
    assert.equal(zero.fragment.ink, null)
    assert.doesNotMatch(zero.svg, /NaN|Infinity/)
    assert.deepEqual(new LayoutPass().layout(new Svg({ max_width: px(100), max_height: px(100) })).size, make_size())
    const minimum = render_element(child, { wrap: { min_width: px(100), max_height: px(50) } })
    assert.deepEqual(minimum.size, { width: 100, height: 50 })
    assert.deepEqual(minimum.fragment.children[0].transform, [0.25, 0, 0, 0.25, 0, 0])
    const relative = render_element(child, { wrap: { font_size: px(10), max_height: em(5) } })
    assert.deepEqual(relative.size, { width: 25, height: 50 })
  },

  'fitting a viewport preserves intentional inner clipping and ordinary box limits'() {
    const child = new Box({ width: px(100), height: px(100), clip: true,
      children: new Rect({ width: px(300), height: px(600), fill: 'blue', stroke: 'none' }) })
    const { fragment } = render_element(child, { wrap: { max_width: px(50), max_height: px(50) } })
    assert.deepEqual(fragment.size, { width: 50, height: 50 })
    assert.deepEqual(fragment.ink, make_rect(0, 0, 50, 50))
    assert.deepEqual(fragment.children[0].transform, [0.5, 0, 0, 0.5, 0, 0])
    const box = new LayoutPass().layout(new Box({ max_height: px(20), children: child }))
    assert.deepEqual(box.size, { width: 100, height: 20 })
    assert.equal(box.children[0].transform, undefined)
    assert.ok(box.overflow.bottom > 0)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} bounded viewport checks passed.`)
