import assert from 'node:assert/strict'
import {
  Box, Field, Rect, Span, Svg, Text, LayoutPass, UnresolvedLengthError,
  em, px, vw, vh, normalize_length, measure_length, resolve_length, resolve_font_size,
  resolve_line_height, evaluate, layout_element, render_element, make_request, available, exact,
} from '../src'
import type { Fragment, Length } from '../src'

function nodes(fragment: Fragment): Fragment[] {
  return [fragment, ...fragment.children.flatMap(child => nodes(child.fragment))]
}
function named(fragment: Fragment, name: string) {
  const result = nodes(fragment).find(node => node.name === name)
  assert.ok(result, `Missing ${name}`)
  return result
}
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
}
function layout_code(source: string): Fragment {
  const result = layout_element(evaluate(source))
  assert.equal(result.kind, 'fragment')
  return result.fragment
}

const tests: Record<string, () => void> = {
  'viewport lengths use independent percentage axes and retain unresolved dependencies'() {
    const basis = { viewport: { width: 800, height: 600 }, font_size: 16 }
    assert.deepEqual(normalize_length(vw(25)), { unit: 'vw', value: 25 })
    assert.deepEqual(measure_length(vh(4)), { unit: 'vh', value: 4 })
    assert.equal(resolve_length(vw(25), basis), 200)
    assert.equal(resolve_length(vh(4), basis), 24)
    assert.equal(resolve_length(vw(-5), basis), -40)
    assert.equal(resolve_font_size(vh(4), basis), 24)
    assert.equal(resolve_line_height(vh(5), { ...basis, font_size: 24 }), 30)
    assert.equal(resolve_length(vh(1), { viewport: { height: 0 } }), 0)
    for (const length of [vw(0), vh(0)]) assert.equal(resolve_length(length), 0)
    assert.ok(Object.isFrozen(vw(2)) && Object.isFrozen(vh(2)))
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => vw(value), /finite/)
      assert.throws(() => vh(value), /finite/)
    }
    assert.throws(() => resolve_length(vw(1), { path: 'card' }, undefined, 'width'), /card.width.*definite viewport width/)
    assert.throws(() => resolve_length(vh(1), { viewport: { width: 800 } }), /definite viewport height/)
  },

  'a reference canvas resolves the root font before content measurement under maxima'() {
    const element = evaluate(`
      <Svg viewport={{ width: 800, height: 600 }} max-width={px(800)} max-height={px(600)} font-size={vh(4)}>
        <Box padding={vw(2)}>
          <HStack gap={vh(2)}>
            <Rect width={em(2)} height={em(1)} />
            <Rect font-size={em(0.5)} width={em(2)} height={em(1)} />
          </HStack>
        </Box>
      </Svg>
    `)
    const result = new LayoutPass().layout(element)
    assert.deepEqual(result.size, { width: 116, height: 56 })
    assert.deepEqual(nodes(result).filter(node => node.name === 'Rect').map(node => node.size),
      [{ width: 48, height: 24 }, { width: 24, height: 12 }])
    assert.deepEqual(named(result, 'Box').content, { x: 16, y: 16, width: 84, height: 24 })
  },

  'definite Svg axes establish references before root typography including aspect and host allocations'() {
    const pass = new LayoutPass()
    const child = new Rect({ width: em(1), height: vh(10) })
    const root = new Svg({ width: px(800), aspect: 2, font_size: vh(5), children: child })
    const natural = pass.layout(root)
    assert.deepEqual(natural.size, { width: 800, height: 400 })
    assert.deepEqual(named(natural, 'Rect').size, { width: 20, height: 40 })
    const resized = pass.layout(root, make_request({ width: exact(400) }), { viewport: { width: 640, height: 480 } })
    assert.deepEqual(resized.size, { width: 400, height: 200 })
    assert.deepEqual(named(resized, 'Rect').size, { width: 10, height: 20 })
    const limited = pass.layout(new Svg({ width: px(800), max_width: px(600), aspect: 2,
      font_size: vh(5), children: child }))
    assert.deepEqual(named(limited, 'Rect').size, { width: 15, height: 30 })
    const equal = pass.layout(new Svg({ min_height: px(400), max_height: px(400), font_size: vh(5), children: child }))
    assert.deepEqual(named(equal, 'Rect').size, { width: 20, height: 40 })
  },

  'maxima, advisory offers, and content never supply missing viewport axes'() {
    const pass = new LayoutPass()
    const root = new Svg({ max_width: px(800), max_height: px(600), font_size: vh(4),
      children: new Rect({ width: em(2), height: em(1) }) })
    for (const request of [make_request(), make_request({ width: available(800), height: available(600) })]) {
      assert.throws(() => pass.layout(root, request), /Svg.font_size.*definite viewport height/)
    }
    const widthOnly = new Svg({ width: px(800), children: new Rect({ width: vw(25), height: px(10) }) })
    assert.deepEqual(named(pass.layout(widthOnly), 'Rect').size, { width: 200, height: 10 })
    assert.throws(() => pass.layout(new Svg({ width: px(800), children: new Rect({ height: vh(10) }) })),
      /Rect\[0\].height.*definite viewport height/)
    assert.throws(() => pass.layout(new Svg({ font_size: vh(4), min_height: em(10), max_height: em(10) })),
      UnresolvedLengthError)
  },

  'authored canvas axes beat root dimensions and hosts can replace them through overrides'() {
    const source = new Svg({ width: px(800), aspect: 2, viewport: { height: 600 }, font_size: vh(4),
      children: new Rect({ width: vw(25), height: em(1) }) })
    const ordinary = layout_element(source).fragment
    assert.deepEqual(named(ordinary, 'Rect').size, { width: 200, height: 24 })
    const hosted = render_element(source, { viewport: { width: 400, height: 300 } })
    assert.deepEqual(hosted.size, { width: 800, height: 400 })
    assert.deepEqual(named(hosted.fragment, 'Rect').size, { width: 200, height: 24 })
    const forced = render_element(source, { viewport: { width: 1000, height: 1000 },
      overrides: { viewport: { width: 400, height: 300 } } })
    assert.deepEqual(forced.size, { width: 800, height: 400 })
    assert.deepEqual(named(forced.fragment, 'Rect').size, { width: 100, height: 12 })
    const sourceCanvas = { height: 600 }
    const bare = new Rect({ viewport: sourceCanvas, font_size: vh(4), width: em(2), height: em(1) })
    sourceCanvas.height = 1200
    assert.deepEqual(layout_element(bare).fragment.size, { width: 48, height: 24 })
    assert.deepEqual(new LayoutPass().layout(bare).size, { width: 48, height: 24 })
    assert.deepEqual(new LayoutPass().layout(bare, make_request(), { viewport: { height: 300 } }).size,
      { width: 48, height: 24 })
    const unreferenced = new Rect({ font_size: vh(4), width: em(2), height: em(1) })
    assert.deepEqual(layout_element(unreferenced, { defaults: { viewport: { height: 600 } } }).fragment.size,
      { width: 48, height: 24 })
  },

  'root references survive nested padding, independent percentage boxes, and nested Svg elements'() {
    const result = layout_code(`
      <Svg width={px(800)} height={px(600)}>
        <Box width={px(400)} padding={px(20)}>
          <Svg width={px(300)} height={px(200)}>
            <HStack width={1} gap={vw(1)}>
              <Rect width={vw(25)} height={vh(10)} />
              <Rect width={0.1} height={px(10)} />
            </HStack>
          </Svg>
        </Box>
      </Svg>
    `)
    const rectangles = nodes(result).filter(node => node.name === 'Rect')
    assert.deepEqual(rectangles[0].size, { width: 200, height: 60 })
    near(rectangles[1].size.width, 29.2)
  },

  'host viewports fill missing axes after explicit references and definite root dimensions'() {
    const canvas = { width: 640, height: 480 }
    const child = new Rect({ width: vw(25), height: vh(10) })
    const layout = (source: Svg) => layout_element(source, { viewport: canvas }).fragment
    const maximumOnly = layout(new Svg({ max_width: px(320), max_height: px(200), children: child }))
    assert.deepEqual(maximumOnly.size, { width: 160, height: 48 })
    const widthOnly = layout(new Svg({ width: px(800), children: child }))
    assert.deepEqual(named(widthOnly, 'Rect').size, { width: 200, height: 48 })
    const withAspect = layout(new Svg({ width: px(800), aspect: 2, children: child }))
    assert.deepEqual(named(withAspect, 'Rect').size, { width: 200, height: 40 })
    const authored = new Svg({ width: px(800), viewport: { height: 600 }, children: child })
    assert.deepEqual(named(layout(authored), 'Rect').size, { width: 200, height: 60 })
    assert.deepEqual(named(layout(new Svg({ viewport: { width: 400 }, children: child })), 'Rect').size,
      { width: 100, height: 48 })
    assert.deepEqual(named(layout(new Svg({ height: px(0), children: child })), 'Rect').size,
      { width: 160, height: 0 })
    const forced = render_element(authored, { viewport: canvas, overrides: { viewport: { height: 300 } } })
    assert.deepEqual(named(forced.fragment, 'Rect').size, { width: 200, height: 30 })
    assert.throws(() => layout_element(new Svg({ children: child }), { viewport: { width: 640 } }),
      /definite viewport height/)
  },

  'host viewports resolve root fonts without feeding content or dependent limits back into the canvas'() {
    const canvas = { width: 640, height: 480 }
    const child = new Rect({ width: em(1), height: em(1) })
    const sized = new Svg({ width: px(800), aspect: 2, font_size: vh(4), children: child })
    assert.deepEqual(named(layout_element(sized, { viewport: canvas }).fragment, 'Rect').size,
      { width: 16, height: 16 })
    const root = new Svg({ font_size: vh(4), max_width: px(320), max_height: px(200), children: child })
    const result = layout_element(root, { viewport: canvas }).fragment
    near(result.size.width, 19.2)
    near(result.size.height, 19.2)
    const dependent = new Svg({ width: px(800), max_width: vw(50), children: new Rect({ width: vw(10), height: px(10) }) })
    const limited = layout_element(dependent, { viewport: canvas }).fragment
    assert.equal(limited.size.width, 320)
    assert.equal(named(limited, 'Rect').size.width, 64)
  },

  'host viewport changes update reused passes without changing previously returned fragments'() {
    const pass = new LayoutPass()
    const source = new Text({ children: new Span({ font_size: vh(10), children: 'Canvas' }) })
    const canvas = { height: 200 }
    const a = pass.layout(source, make_request(), { viewport: canvas })
    canvas.height = 400
    const b = pass.layout(source, make_request(), { viewport: canvas })
    near(b.size.width, 2 * a.size.width)
    assert.equal(pass.layout(source, make_request(), { viewport: { height: 200 } }), a)
    assert.throws(() => pass.layout(source, make_request(), { viewport: { height: -1 } }),
      /viewport.height/)
  },

  'viewport lengths cover wrapping gaps, flex bases, paint, and local coordinates'() {
    const result = layout_code(`
      <Svg viewport={{ width: 800, height: 600 }}>
        <HStack width={px(220)} wrap gap={vw(2.5)} line-gap={vh(2)}>
          <Rect basis={vw(12.5)} height={vh(10)} stroke-width={vh(0.5)} stroke-dasharray={[vw(1), vh(1)]} />
          <Rect basis={vw(12.5)} height={vh(10)} />
          <Rect basis={vw(12.5)} height={vh(10)} />
        </HStack>
      </Svg>
    `)
    assert.deepEqual(result.size, { width: 220, height: 132 })
    const rect = named(result, 'Rect')
    assert.equal(rect.draw[0].stroke_width, 3)
    assert.deepEqual(rect.draw[0].stroke_dasharray, [8, 6])
    const group = layout_code(`
      <Svg viewport={{ width: 800, height: 600 }}>
        <Group width={px(400)} height={px(200)}>
          <Circle width={px(100)} height={px(100)} x={vw(10)} y={vh(5)} radius={vh(2)} />
        </Group>
      </Svg>
    `)
    assert.deepEqual(named(group, 'Group').children[0].offset, { x: 80, y: 30 })
    const circle = named(group, 'Circle').draw[0]
    assert.equal(circle.kind, 'ellipse')
    if (circle.kind === 'ellipse') assert.equal(circle.radius.x, 12)
  },

  'vector-field arrowheads retain the root viewport when resolving their scoped lengths'() {
    const pass = new LayoutPass()
    for (const width of [400, 800]) {
      const viewport = { width, height: 600 }
      const props = { width: px(200), height: px(100),
        vectors: [{ point: [0, 0] as const, vector: [1, 1] as const }] }
      const layout = (head_size: Length) => pass.layout(
        new Svg({ viewport, children: new Field({ ...props, head_size }) }))
      assert.deepEqual(named(layout(vw(1)), 'Field').draw, named(layout(px(width / 100)), 'Field').draw)
    }
  },

  'canvas changes invalidate geometry and inline typography while repeated queries reuse caches'() {
    const pass = new LayoutPass()
    const shape = new Rect({ width: px(100), height: px(100), stroke_width: vh(1) })
    const source = new Box({ children: shape })
    const first = pass.layout(source, make_request(), { viewport: { height: 600 } })
    const second = pass.layout(source, make_request(), { viewport: { height: 300 } })
    assert.equal(named(first, 'Rect').draw[0].stroke_width, 6)
    assert.equal(named(second, 'Rect').draw[0].stroke_width, 3)
    assert.equal(pass.layout(source, make_request(), { viewport: { height: 600 } }), first)

    const text = new Text({ children: new Span({ font_size: vh(10), line_height: vh(12), children: 'Canvas' }) })
    const a = pass.layout(text, make_request(), { viewport: { height: 200 } })
    const b = pass.layout(text, make_request(), { viewport: { height: 400 } })
    near(b.size.width, 2 * a.size.width)
    near(a.size.height, 24)
    near(b.size.height, 48)
    assert.equal(pass.layout(text, make_request(), { viewport: { height: 200 } }), a)
    const leading = new Text({ line_height: vh(10), text: 'Leading' })
    near(pass.layout(leading, make_request(), { viewport: { height: 200 } }).size.height, 20)
    near(pass.layout(leading, make_request(), { viewport: { height: 400 } }).size.height, 40)
  },

  'fitting scales completed viewport typography without feeding bounds into the reference canvas'() {
    const root = new Svg({ viewport: { height: 600 }, max_width: px(240), max_height: px(600),
      font_size: vh(4), children: new Rect({ width: em(20), height: em(1) }) })
    const result = new LayoutPass().layout(root)
    assert.deepEqual(result.size, { width: 240, height: 12 })
    assert.deepEqual(named(result, 'Rect').size, { width: 480, height: 24 })
    assert.deepEqual(result.children[0].transform, [0.5, 0, 0, 0.5, 0, 0])
    for (const height of [-1, Infinity, NaN]) {
      assert.throws(() => layout_element(new Rect(), { viewport: { height } }), /viewport.height/)
    }
    assert.throws(() => new LayoutPass().layout(new Svg({ viewport: { width: -1 } })), /Svg.viewport.width/)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} viewport checks passed.`)
