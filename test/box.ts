import assert from 'node:assert/strict'
import {
  Box, Frame, Svg, Square, Rect, Text, TextBox, TextFrame, TitleBox, TitleFrame,
  TextFigure, Legend, Slide, Fonts, LayoutPass, evaluate,
  px, em, make_request, exact, available, make_size, make_insets,
  render_svg, inspect_fragment,
} from '../src/index'
import type { FontProvider, InsetSpec, Length } from '../src/index'
import { Fixed } from './fixtures/leaves'

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

const tests: Record<string, () => void> = {
  'Svg and Box hug a Square with one query per element'() {
    const source = evaluate(`<Svg><Box padding={em(1)} border_width={px(2)}>
      <Square width={px(64)} fill="teal" stroke="none"/>
    </Box></Svg>`)
    const before = JSON.stringify(source)
    const pass = new LayoutPass()
    const root = pass.layout(source)
    const box = root.children[0].fragment, square = box.children[0]
    assert.deepEqual(root.size, { width: 100, height: 100 })
    assert.deepEqual(box.size, root.size)
    assert.deepEqual(box.content, { x: 18, y: 18, width: 64, height: 64 })
    assert.deepEqual(square.offset, { x: 18, y: 18 })
    assert.deepEqual(square.fragment.size, { width: 64, height: 64 })
    assert.deepEqual(root.ink, { x: 0, y: 0, width: 100, height: 100 })
    assert.deepEqual(root.overflow, make_insets())
    assert.deepEqual(pass.stats, { queries: 3, layouts: 3, hits: 0 })
    assert.equal(pass.layout(source), root)
    assert.equal(JSON.stringify(source), before)
    assert.match(render_svg(root), /width="100" height="100" viewBox="0 0 100 100"/)
    assert.match(inspect_fragment(root), /content=18,18,64,64/)
    assert.deepEqual(pass.layout(new Svg({ children: new Box({ children: new Square() }) })).size,
      { width: 16, height: 16 })
  },

  'nested boxes add insets and propagate baselines through outer padding'() {
    const pass = new LayoutPass()
    const leaf = new Fixed({ content_width: px(40), content_height: px(20), fill: 'teal' })
    const inner = new Box({
      padding: { left: px(3), top: px(4), right: px(5), bottom: px(6) },
      border_width: px(2), children: leaf,
    })
    const box = new Box({
      padding: { left: px(7), top: px(8), right: px(9), bottom: px(10) }, children: inner,
    })
    const root = pass.layout(new Svg({ children: box }))
    const wrapper = root.children[0].fragment, frame = wrapper.children[0]
    assert.deepEqual(root.size, { width: 68, height: 52 })
    assert.equal(wrapper.name, 'Box')
    assert.deepEqual(frame.offset, { x: 7, y: 8 })
    assert.deepEqual(frame.fragment.size, { width: 52, height: 34 })
    assert.deepEqual(frame.fragment.content, { x: 5, y: 6, width: 40, height: 20 })
    assert.equal(frame.fragment.guides.baseline, 22)
    assert.equal(root.guides.baseline, 30)
    const outer = pass.layout(new Box({ padding: px(4), children: box }))
    assert.deepEqual(outer.size, { width: 76, height: 60 })
    assert.equal(outer.guides.baseline, 34)
  },

  'padding shorthands agree with named sides across box and document elements'() {
    const pass = new LayoutPass()
    const child = new Fixed({ content_width: px(40), content_height: px(20) })
    const cases: readonly (readonly [InsetSpec, InsetSpec])[] = [
      [{ h: 0.05, v: em(0.2) }, { left: 0.05, right: 0.05, top: em(0.2), bottom: em(0.2) }],
      [[0.05, em(0.2)], { left: 0.05, right: 0.05, top: em(0.2), bottom: em(0.2) }],
      [{ t: px(4), b: em(0.3), l: 0.05, r: px(5) }, { top: px(4), bottom: em(0.3), left: 0.05, right: px(5) }],
      [[px(4), em(0.3), 0.05, px(5)], { top: px(4), bottom: em(0.3), left: 0.05, right: px(5) }],
    ]
    const context = { reference: { width: 240, height: 120 } }
    for (const Container of [Box, Frame, TextBox, TextFrame, TitleBox, TitleFrame, TextFigure, Legend, Slide]) {
      for (const [padding, named] of cases) {
        const props = { font_size: px(20), children: child }
        const source = new Container({ ...props, padding }), canonical = new Container({ ...props, padding: named })
        for (const request of [make_request(), make_request({ width: exact(200), height: exact(100) })]) {
          assert.deepEqual(pass.layout(source, request, context), pass.layout(canonical, request, context), Container.name)
        }
      }
    }
    const box = pass.layout(new Box({ padding: [px(4), px(6), px(3), px(5)], children: child }))
    assert.deepEqual(box.size, { width: 48, height: 30 })
    assert.deepEqual(box.content, { x: 3, y: 4, width: 40, height: 20 })
    assert.deepEqual(box.children[0].offset, { x: 3, y: 4 })
    assert.equal(box.guides.baseline, 20)
  },

  'padding shorthands work in JSX and source elements snapshot their inputs'() {
    const pass = new LayoutPass()
    for (const padding of ['{ h: px(3), v: px(4) }', '[px(3), px(4)]',
      '{ t: px(4), b: px(4), l: px(3), r: px(3) }', '[px(4), px(4), px(3), px(3)]']) {
      const source = evaluate(`<Svg><Box padding={${padding}}><Square width={px(20)} /></Box></Svg>`)
      assert.deepEqual(pass.layout(source).size, { width: 26, height: 28 })
    }
    const length = { value: 3, unit: 'px' as const }
    const tuple: [Length, Length] = [length, px(4)], object = { h: length, v: px(4) }
    const a = new Box({ padding: tuple }), b = new Box({ padding: object })
    length.value = 30
    tuple[1] = px(40)
    object.v = px(50)
    assert.deepEqual(pass.layout(a).size, { width: 6, height: 8 })
    assert.deepEqual(pass.layout(b).size, { width: 6, height: 8 })
    assert.ok(Object.isFrozen(a.props.padding) && Object.isFrozen(b.props.padding))
    assert.equal(pass.layout(a), pass.layout(a))
  },

  'outer padding leaves inner sizing intact and stretch forwards exact allocations'() {
    const pass = new LayoutPass()
    const inner = new Box({ width: px(80), height: px(40), padding: px(4) })
    const box = new Box({ padding: px(8), align: 'stretch', children: inner })
    const natural = pass.layout(box)
    assert.deepEqual(natural.size, { width: 96, height: 56 })
    assert.deepEqual(natural.children[0].fragment.size, { width: 80, height: 40 })
    const allocated = pass.layout(box, make_request({ width: exact(60), height: exact(30) }))
    assert.deepEqual(allocated.size, { width: 60, height: 30 })
    assert.deepEqual(allocated.children[0].fragment.size, { width: 44, height: 14 })
    const tiny = pass.layout(box, make_request({ width: exact(10), height: exact(0) }))
    assert.deepEqual(tiny.size, { width: 10, height: 0 })
    assert.deepEqual(tiny.children[0].fragment.size, make_size())
    assert.ok(tiny.overflow.right > 0 && tiny.overflow.bottom > 0)
    assert.doesNotMatch(render_svg(tiny), /NaN|Infinity/)

    // Ordinary alignment keeps the child offer advisory, even in a tight wrapper.
    const loose = pass.layout(new Box({ padding: px(8), children: inner }),
      make_request({ width: exact(60), height: exact(30) }))
    assert.deepEqual(loose.children[0].fragment.size, { width: 80, height: 40 })
    assert.ok(loose.overflow.right > 0 && loose.overflow.bottom > 0)
  },

  'frame aspects derive missing axes before child layout, including padding and borders'() {
    const pass = new LayoutPass()
    for (const Container of [Box, Frame]) {
      const child = new Fixed({ content_width: px(40), content_height: px(20) })
      const props = { aspect: 2, padding: px(10), border_width: px(2), align: 'center' as const, children: child }
      const frame = pass.layout(new Container({ ...props, width: px(200) }))
      assert.deepEqual(frame.size, { width: 200, height: 100 })
      assert.deepEqual(frame.content, { x: 12, y: 12, width: 176, height: 76 })
      assert.deepEqual(frame.children[0].offset, { x: 80, y: 40 })
      assert.equal(frame.guides.baseline, 56)
      assert.deepEqual(pass.layout(new Container({ ...props, height: px(100) })).size, frame.size)
      assert.deepEqual(pass.layout(new Container({ ...props, width: 'fill' }),
        make_request({ width: available(200) })).size, frame.size)
      assert.deepEqual(pass.layout(new Container({ ...props, min_width: px(200), max_width: px(200) })).size,
        frame.size)
      const fractions = pass.layout(new Container({ ...props, width: px(200), children:
        new Rect({ width: 0.5, height: 0.5, stroke: 'none' }) }))
      assert.deepEqual(fractions.children[0].fragment.size, { width: 88, height: 38 })
      const stretched = pass.layout(new Container({ ...props, width: px(200), align: 'stretch' }))
      assert.deepEqual(stretched.children[0].fragment.size, { width: 176, height: 76 })
    }
  },

  'natural frame aspects add space without scaling content or inventing percentage references'() {
    const source = new Frame({ aspect: 1, padding: px(10), border_width: px(2), align: 'center',
      children: new Fixed({ content_width: px(40), content_height: px(20) }) })
    const before = JSON.stringify(source), pass = new LayoutPass()
    const frame = pass.layout(source, make_request({ width: available(200) }))
    assert.deepEqual(frame.size, { width: 64, height: 64 })
    assert.deepEqual(frame.children[0].fragment.size, { width: 40, height: 20 })
    assert.deepEqual(frame.children[0].offset, { x: 12, y: 22 })
    assert.deepEqual(pass.layout(new Box({ aspect: 1 })).size, make_size())
    assert.deepEqual(pass.layout(new Box({ aspect: 1, min_width: px(100) })).size, { width: 100, height: 100 })
    assert.throws(() => pass.layout(new Box({ aspect: 1, children: new Rect({ width: 0.5 }) }),
      make_request({ width: available(200) })), /definite fraction reference/)
    assert.equal(pass.layout(source, make_request({ width: available(200) })), frame)
    assert.equal(JSON.stringify(source), before)
  },

  'fixed-height frame aspects establish width before text reflow'() {
    const pass = new LayoutPass()
    const props = { height: px(100), padding: px(8), children: new Text({
      text: 'This paragraph wraps using the width derived from the frame aspect.', font_size: px(20),
    }) }
    const frame = pass.layout(new Frame({ ...props, aspect: 2 }))
    const explicit = pass.layout(new Frame({ ...props, width: px(200) }))
    assert.equal(render_svg(frame), render_svg(explicit))
    assert.ok(frame.children[0].fragment.children.length > 1)
  },

  'frame aspect yields to exact sizes and limits, with honest overflow and clipping'() {
    const pass = new LayoutPass()
    const props = { width: px(200), aspect: 2, padding: px(10), children:
      new Fixed({ content_width: px(300), content_height: px(120), fill: 'teal' }) }
    assert.deepEqual(pass.layout(new Frame({ ...props, height: px(60) })).size, { width: 200, height: 60 })
    assert.deepEqual(pass.layout(new Frame({ ...props, max_height: px(60) })).size, { width: 200, height: 60 })
    assert.deepEqual(pass.layout(new Frame({ ...props, min_height: px(150) })).size, { width: 200, height: 150 })
    const source = new Frame(props)
    assert.deepEqual(pass.layout(source, make_request({ width: exact(80), height: exact(40) })).size,
      { width: 80, height: 40 })
    const visible = pass.layout(source), clipped = pass.layout(new Frame({ ...props, clip: true }))
    assert.ok(visible.overflow.right > 0 && visible.overflow.bottom > 0)
    assert.deepEqual(clipped.overflow, visible.overflow)
    assert.deepEqual(clipped.ink, { x: 0, y: 0, width: 200, height: 100 })
    const zero = pass.layout(source, make_request({ width: exact(0) }))
    assert.deepEqual(zero.size, make_size())
    assert.doesNotMatch(render_svg(zero), /NaN|Infinity/)
  },

  'each box resolves em padding with its own font before measuring children'() {
    const pass = new LayoutPass()
    const source = new Svg({ font_size: px(10), children: new Box({
      font_size: em(2), padding: em(0.5), border_width: em(0.1),
      children: new Box({ font_size: em(0.5), padding: em(0.5),
        children: new Square({ width: em(2) }),
      }),
    }) })
    const root = pass.layout(source), box = root.children[0].fragment
    const wrapper = box.children[0].fragment
    assert.deepEqual(wrapper.size, { width: 30, height: 30 })
    assert.deepEqual(wrapper.children[0].offset, { x: 5, y: 5 })
    assert.deepEqual(wrapper.children[0].fragment.size, { width: 20, height: 20 })
    assert.deepEqual(box.content, { x: 12, y: 12, width: 30, height: 30 })
    assert.deepEqual(root.size, { width: 54, height: 54 })
  },

  'nested boxes establish their own percentage references after padding'() {
    const pass = new LayoutPass()
    const source = new Svg({ width: px(200), height: px(100), children: new Box({
      width: 1, height: 1, padding: px(10), children: new Box({
        width: 1, height: 1, padding: 0.1,
        children: new Rect({ width: 0.5, height: px(20), stroke: 'none' }),
      }),
    }) })
    const box = pass.layout(source).children[0].fragment
    const wrapper = box.children[0].fragment
    assert.deepEqual(box.content, { x: 10, y: 10, width: 180, height: 80 })
    assert.deepEqual(wrapper.size, { width: 180, height: 80 })
    assert.deepEqual(wrapper.content, { x: 18, y: 8, width: 144, height: 64 })
    assert.deepEqual(wrapper.children[0].fragment.size, { width: 72, height: 20 })
    assert.deepEqual(wrapper.children[0].offset, { x: 18, y: 8 })
    const partial = pass.layout(new Box({ width: px(200), padding: px(10),
      children: new Rect({ width: 0.5, height: px(20), stroke: 'none' }) }))
    assert.deepEqual(partial.size, { width: 200, height: 40 })
    assert.equal(partial.children[0].fragment.size.width, 90)
    const fixed = pass.layout(new Box({ min_width: px(100), max_width: px(100),
      children: new Rect({ width: 0.5, height: px(20) }) }))
    assert.equal(fixed.children[0].fragment.size.width, 50)
  },

  'hugging axes reject percentage cycles instead of using temporary offers'() {
    const pass = new LayoutPass()
    const hugging = new Box({ children: new Rect({ width: 0.5 }) })
    assert.throws(() => pass.layout(hugging, make_request({ width: available(200) }),
      { reference: { width: 200 } }), /Box\/Rect\[0\]\.width.*definite fraction reference/)
    assert.throws(() => pass.layout(new Svg({ children: new Box({ padding: 0.1 }) })),
      /Box\[0\]\.padding.left.*definite fraction reference/)
    assert.throws(() => pass.layout(new Box({ width: px(100), children: new Rect({ height: 0.5 }) })),
      /Rect\[0\]\.height.*definite fraction reference/)
    const zero = pass.layout(new Box({ width: px(0), height: px(0),
      children: new Rect({ width: 0.5, height: 0.5 }) }))
    assert.deepEqual(zero.children[0].fragment.size, make_size())
  },

  'framed text reflows without changing font measurements or source descriptions'() {
    const fonts = new Fonts()
    let shapes = 0
    const provider: FontProvider = { resolve(family, weight, style) {
      const font = fonts.resolve(family, weight, style)
      return { ...font, shape(text) { shapes++; return font.shape(text); } }
    } }
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } })
    const text = new Text({ text: 'A framed paragraph reflows at its offered width and keeps its font size.',
      font_size: px(20), line_height: em(1.4) })
    const source = JSON.stringify(text)
    const box = new Box({ padding: px(12), border_width: px(2), children: text })
    const wide = pass.layout(box, make_request({ width: exact(360) }))
    const before = shapes
    const narrow = pass.layout(box, make_request({ width: exact(180) }))
    const a = wide.children[0].fragment, b = narrow.children[0].fragment
    assert.ok(b.children.length > a.children.length)
    assert.equal(shapes, before)
    near(b.size.height, b.children.length * 28)
    near(narrow.size.height, b.size.height + 28)
    assert.equal(narrow.content!.width, 152)
    near(narrow.guides.baseline!, 14 + b.guides.baseline!)
    assert.equal(JSON.stringify(text), source)
    assert.deepEqual(pass.stats, { queries: 4, layouts: 4, hits: 0 })
    const root = pass.layout(new Svg({ width: px(180), children: box }))
    near(root.size.height, narrow.size.height)
    assert.equal(root.size.width, 180)
  },

  'alignment moves completed children and stretch uses exact established axes'() {
    const pass = new LayoutPass()
    const leaf = new Fixed({ content_width: px(40), content_height: px(20), fill: 'teal' })
    const frame = { width: px(100), height: px(80), padding: px(10), children: leaf }
    const center = pass.layout(new Box({ ...frame, align: 'center' }))
    assert.deepEqual(center.children[0].offset, { x: 30, y: 30 })
    assert.equal(center.guides.baseline, 46)
    const end = pass.layout(new Box({ ...frame, align: { x: 'end', y: 'start' } }))
    assert.equal(center.children[0].fragment, end.children[0].fragment)
    assert.deepEqual(end.children[0].offset, { x: 50, y: 10 })
    const stretch = pass.layout(new Box({ ...frame, align: 'stretch' }))
    assert.deepEqual(stretch.children[0].fragment.size, { width: 80, height: 60 })
    assert.deepEqual(stretch.children[0].offset, { x: 10, y: 10 })
    const natural = pass.layout(new Box({ padding: px(10), align: 'stretch', children: leaf }))
    assert.deepEqual(natural.size, { width: 60, height: 40 })
  },

  'empty and undersized boxes retain inset overflow without negative content dimensions'() {
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(new Box()).size, make_size())
    const empty = pass.layout(new Box({ padding: px(8), border_width: px(2) }))
    assert.deepEqual(empty.size, { width: 20, height: 20 })
    assert.deepEqual(empty.content, { x: 10, y: 10, width: 0, height: 0 })
    const tiny = pass.layout(new Box({ padding: px(8), width: px(10), height: px(8) }))
    assert.deepEqual(tiny.content, { x: 8, y: 8, width: 0, height: 0 })
    assert.deepEqual(tiny.overflow, { left: 0, top: 0, right: 6, bottom: 8 })
    const border = pass.layout(new Box({ border_width: px(20), width: px(10), height: px(8) }))
    assert.deepEqual(border.ink, { x: 0, y: 0, width: 10, height: 8 })
    assert.doesNotMatch(render_svg(border), /NaN|Infinity/)
    assert.throws(() => pass.layout(new Box({ children: [new Rect(), new Rect()] })), /one content/)
    assert.throws(() => pass.layout(new Box({ padding: px(-1) })), /padding/)
  },

  'rounded clipping preserves overflow and borders stay inside the allocated frame'() {
    const pass = new LayoutPass()
    const props = { width: px(30), height: px(16), padding: px(2), border_width: px(2),
      border_radius: px(8), children: new Fixed({ fill: 'coral' }) }
    const visible = pass.layout(new Box(props))
    const clipped = pass.layout(new Box({ ...props, clip: true }))
    assert.ok(visible.ink!.width > 30)
    assert.deepEqual(clipped.ink, { x: 0, y: 0, width: 30, height: 16 })
    assert.deepEqual(clipped.overflow, visible.overflow)
    assert.deepEqual(clipped.children[0].fragment.clip,
      { x: 2, y: 2, width: 26, height: 12, radius: { x: 6, y: 6 } })
    const border = clipped.children.at(-1)!.fragment
    assert.equal(border.name, 'Border')
    assert.deepEqual(border.overflow, make_insets())
    assert.match(render_svg(clipped), /rx="6" ry="6"/)
    const frame = pass.layout(new Frame({ children: new Square({ width: px(20), stroke: 'none' }) }))
    assert.deepEqual(frame.size, { width: 22, height: 22 })
    assert.deepEqual(frame.ink, { x: 0, y: 0, width: 22, height: 22 })
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} box checks passed.`)
