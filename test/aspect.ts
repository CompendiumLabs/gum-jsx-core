import assert from 'node:assert/strict'
import {
  Box, Frame, Text, Span, HStack, VStack, Svg, Spacer, Overlay, Attach, Anchor,
  Rotate, TransformBox, Rect, Square, Circle, Graph, Group, Slide, TitleFrame,
  LayoutPass, define_element, make_fragment, make_size, make_request,
  exact, available, px, resolve_sizing, prepare_request, finish_size, render_svg,
} from '../src/index'
import { Fixed } from './fixtures/leaves'

const tests: Record<string, () => void> = {
  'shared sizing derives either missing axis and prepares an idempotent allocation'() {
    const cases = [
      [{ width: px(180), aspect: 2 }, { width: 180, height: 90 }],
      [{ height: px(90), aspect: 2 }, { width: 180, height: 90 }],
      [{ min_width: px(180), max_width: px(180), aspect: 2 }, { width: 180, height: 90 }],
      [{ min_height: px(90), max_height: px(90), aspect: 2 }, { width: 180, height: 90 }],
      [{ width: px(180), height: px(30), aspect: 2 }, { width: 180, height: 30 }],
      [{ width: px(180), max_height: px(50), aspect: 2 }, { width: 180, height: 50 }],
      [{ height: px(90), min_width: px(200), aspect: 2 }, { width: 200, height: 90 }],
      [{ width: px(0), aspect: 2 }, { width: 0, height: 0 }],
    ] as const
    for (const [props, size] of cases) {
      const sizing = resolve_sizing(props), request = make_request()
      const prepared = prepare_request(request, sizing)
      assert.deepEqual(prepared, make_request({ width: exact(size.width), height: exact(size.height) }))
      assert.deepEqual(prepare_request(prepared, sizing), prepared)
      assert.deepEqual(finish_size(make_size(300, 100), request, sizing), size)
      const allocated = make_request({ width: exact(45), height: exact(23) })
      assert.deepEqual(prepare_request(allocated, sizing), allocated)
    }
  },

  'natural aspect adds allocation space, respects limits, and remains stable when finished again'() {
    const request = make_request({ width: available(500), height: available(500) })
    const sizing = resolve_sizing({ aspect: 1 })
    assert.deepEqual(prepare_request(request, sizing), request)
    assert.deepEqual(finish_size(make_size(40, 20), request, sizing), { width: 40, height: 40 })
    assert.deepEqual(finish_size(make_size(), request, sizing), make_size())
    for (const aspect of [0.1, 0.3, 1, 1.5, Math.PI, 100]) {
      for (const limits of [{}, { max_width: px(35) }, { min_height: px(25), max_width: px(10) }]) {
        const sizing = resolve_sizing({ aspect, ...limits })
        const size = finish_size(make_size(37.1, 19.3), request, sizing)
        assert.deepEqual(finish_size(size, request, sizing), size)
      }
    }
    assert.deepEqual(finish_size(make_size(2e-100, 1e-100), make_request(), sizing),
      { width: 2e-100, height: 2e-100 })
    assert.throws(() => finish_size(make_size(1, 1e308), make_request(), resolve_sizing({ aspect: 10 })), /finite/)
  },

  'elements share explicit aspect sizing without per-type opt-in'() {
    const pass = new LayoutPass()
    const leaf = new Fixed({ content_width: px(30), content_height: px(10) })
    for (const Container of [Box, Frame, HStack, VStack, Svg, Overlay, Attach, Anchor,
      Rotate, TransformBox, Group, Graph, Slide, TitleFrame]) {
      const fragment = pass.layout(new Container({ width: px(200), aspect: 2, children: leaf }))
      assert.deepEqual(fragment.size, { width: 200, height: 100 }, Container.name)
    }
    for (const Leaf of [Text, Span, Spacer, Rect, Square, Circle]) {
      assert.deepEqual(pass.layout(new Leaf({ width: px(200), aspect: 2 })).size,
        { width: 200, height: 100 }, Leaf.name)
    }
    const Custom = define_element('AspectProbe', (_props, query) => {
      assert.deepEqual(query.request, make_request({ width: exact(200), height: exact(100) }))
      return make_fragment({ size: finish_size(make_size(12, 7), query.request, query.sizing) })
    })
    assert.deepEqual(pass.layout(new Custom({ width: px(200), aspect: 2 })).size, { width: 200, height: 100 })
    const Unfinished = define_element('Unfinished', () => make_fragment({ size: make_size(20, 10) }))
    assert.throws(() => pass.layout(new Unfinished({ aspect: 1 })), /use finish_size/)
  },

  'text reflows at aspect-derived width without magnifying glyphs'() {
    const pass = new LayoutPass()
    const props = { text: 'Aspect sets the allocated text box, not the size of the glyphs.',
      font_size: px(20), height: px(100), justify: 'center' as const }
    const source = new Text({ ...props, aspect: 2 }), before = JSON.stringify(source)
    const result = pass.layout(source)
    assert.equal(render_svg(result), render_svg(pass.layout(new Text({ ...props, width: px(200) }))))
    assert.ok(result.children.length > 1)
    assert.equal(pass.layout(source), result)
    assert.equal(JSON.stringify(source), before)
    const natural = pass.layout(new Text({ text: 'Small', aspect: 1 }))
    assert.equal(natural.size.width, natural.size.height)
  },

  'stacks allocate aspect-derived space before flex and percentage child layout'() {
    const pass = new LayoutPass()
    for (const Stack of [HStack, VStack]) {
      const source = new Stack({ width: px(200), aspect: 2, align: 'stretch', children: [
        new Box({ grow: 1, children: new Rect({ width: 1, height: 1, stroke: 'none' }) }),
        new Box({ grow: 1, children: new Rect({ width: 1, height: 1, stroke: 'none' }) }),
      ] })
      const result = pass.layout(source)
      const expected = Stack === HStack ? { width: 100, height: 100 } : { width: 200, height: 50 }
      assert.deepEqual(result.size, { width: 200, height: 100 })
      for (const child of result.children) {
        assert.deepEqual(child.fragment.size, expected)
        assert.deepEqual(child.fragment.children[0].fragment.size, expected)
      }
      const filled = pass.layout(new Stack({ width: 'fill', aspect: 2 }),
        make_request({ width: available(200) }))
      assert.deepEqual(filled.size, result.size)
    }
    const natural = pass.layout(new VStack({ aspect: 1, align: 'center', children: [
      new Fixed({ content_width: px(20), content_height: px(40) }),
      new Fixed({ content_width: px(20), content_height: px(40) }),
    ] }))
    assert.deepEqual(natural.size, { width: 80, height: 80 })
    assert.equal(natural.children[0].offset.x, 30)
    assert.deepEqual(natural.children[0].fragment.size, { width: 20, height: 40 })
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} shared aspect checks passed.`)
