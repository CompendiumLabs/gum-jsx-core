import { FREEZE_ENABLED } from '../src/lib/immutable'
import assert from 'node:assert/strict'
import {
  LayoutPass, Svg, Box, Graph, Rect, RoundedRect, Square, Circle, Ellipse, Line, HLine, VLine, Polyline, Polygon, Path,
  px, em, make_request, available, exact, move_to, line_to, quad_to, curve_to, close_path, render_svg,
  data_bounds, infer_coordinates, evaluate,
} from '../src/index'
import type { HLineProps, VLineProps, Length, PathDraw } from '../src/index'

const tests: Record<string, () => void> = {
  'aspectless shapes fill available space from Svg, including through Box insets'() {
    const pass = new LayoutPass()
    for (const Shape of [Rect, RoundedRect, Ellipse, Line, Polyline, Polygon, Path]) {
      const root = pass.layout(new Svg({ width: px(200), height: px(100), children: new Shape() }))
      const shape = root.children[0].fragment
      assert.deepEqual(shape.size, { width: 200, height: 100 })
      if (shape.draw[0]?.kind === 'rect') {
        assert.deepEqual(shape.draw[0].rect, { x: 0, y: 0, width: 200, height: 100 })
      } else if (shape.draw[0]?.kind === 'ellipse') {
        assert.deepEqual(shape.draw[0].center, { x: 100, y: 50 })
        assert.deepEqual(shape.draw[0].radius, { x: 100, y: 50 })
      }
    }

    // Box can hug a child that accepts its offer; it need not force an exact size.
    const root = pass.layout(new Svg({ width: px(200), height: px(100), children: new Box({
      padding: px(10), border_width: px(2),
      children: new Box({ padding: px(4), children: new Rect({ stroke_width: px(3) }) }),
    }) }))
    const box = root.children[0].fragment, wrapper = box.children[0]
    const shape = wrapper.fragment.children[0]
    assert.deepEqual(box.size, root.size)
    assert.deepEqual(box.content, { x: 12, y: 12, width: 176, height: 76 })
    assert.deepEqual(wrapper.offset, { x: 12, y: 12 })
    assert.deepEqual(shape.offset, { x: 4, y: 4 })
    assert.deepEqual(shape.fragment.size, { width: 168, height: 68 })
    assert.equal(shape.fragment.draw[0].stroke_width, 3)
  },

  'aspectless axes size independently under natural, preferred, and constrained requests'() {
    const pass = new LayoutPass()
    const offer = make_request({ width: available(200), height: available(100) })
    for (const Shape of [Rect, Ellipse]) {
      assert.deepEqual(pass.layout(new Shape({ width: px(60) }), offer).size,
        { width: 60, height: 100 })
      assert.deepEqual(pass.layout(new Shape({ height: px(30) }), offer).size,
        { width: 200, height: 30 })
      assert.deepEqual(pass.layout(new Shape({ width: px(60) })).size, { width: 60, height: 16 })
      assert.deepEqual(pass.layout(new Shape({ height: px(30) })).size, { width: 16, height: 30 })
      const limited = new Shape({ min_width: px(240), max_height: px(80) })
      assert.deepEqual(pass.layout(limited, offer).size, { width: 240, height: 80 })
      assert.deepEqual(pass.layout(limited, make_request({ width: exact(50), height: exact(30) })).size,
        { width: 50, height: 30 })
      const zero = pass.layout(new Shape(), make_request({ width: available(0), height: available(100) }))
      assert.deepEqual(zero.size, { width: 0, height: 100 })
      assert.equal(zero.ink, null)
      assert.deepEqual(pass.layout(new Svg({ width: px(200), children: new Shape() })).size,
        { width: 200, height: 16 })
      assert.deepEqual(pass.layout(new Svg({ height: px(100), children: new Shape() })).size,
        { width: 16, height: 100 })
    }
  },

  'intrinsic and explicit shape aspects remain preferred under available offers'() {
    const pass = new LayoutPass()
    for (const Shape of [Square, Circle]) {
      const root = pass.layout(new Svg({ width: px(200), height: px(100), children: new Shape() }))
      assert.deepEqual(root.children[0].fragment.size, { width: 100, height: 100 })
      assert.deepEqual(pass.layout(new Svg({ children: new Shape({ width: px(64) }) })).size,
        { width: 64, height: 64 })
    }
    for (const Shape of [Rect, Ellipse]) {
      const shape = new Shape({ aspect: 2 })
      const root = pass.layout(new Svg({ width: px(200), height: px(80), children: shape }))
      assert.deepEqual(root.children[0].fragment.size, { width: 160, height: 80 })
      assert.deepEqual(pass.layout(shape, make_request({ width: exact(200), height: exact(80) })).size,
        { width: 200, height: 80 })
    }
  },

  'all primitives have finite natural geometry and explicit empty or degenerate ink'() {
    const pass = new LayoutPass()
    for (const Shape of [Rect, RoundedRect, Square, Circle, Ellipse, Line, Polyline, Polygon, Path]) {
      const normal = pass.layout(new Shape())
      assert.deepEqual(normal.size, { width: 16, height: 16 })
      const zero = pass.layout(new Shape(), make_request({ width: exact(0), height: exact(0) }))
      assert.deepEqual(zero.size, { width: 0, height: 0 })
      assert.doesNotMatch(render_svg(zero), /NaN|Infinity/)
      assert.equal(zero.ink, null)
    }
    assert.equal(pass.layout(new Path({ commands: [move_to(0, 0)] })).ink, null)
    const dot = pass.layout(new Line({ from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 },
      stroke_linecap: 'round', stroke_width: px(4) }))
    assert.deepEqual(dot.ink, { x: 6, y: 6, width: 4, height: 4 })
  },

  'circle and ellipse radii use their declared scalar or axis references'() {
    const pass = new LayoutPass()
    const request = make_request({ width: exact(100), height: exact(40) })
    const circle = pass.layout(new Circle({ stroke: 'none', fill: 'red' }), request).draw[0]
    const ellipse = pass.layout(new Ellipse(), request).draw[0]
    assert.ok(circle.kind === 'ellipse' && ellipse.kind === 'ellipse')
    assert.deepEqual(circle.center, { x: 50, y: 20 })
    assert.deepEqual(circle.radius, { x: 20, y: 20 })
    assert.deepEqual(ellipse.radius, { x: 50, y: 20 })
    const mixed = pass.layout(new Ellipse({ font_size: px(10), center: { x: px(12), y: em(2) },
      radius: { x: 0.25, y: em(1) } }), request).draw[0]
    assert.ok(mixed.kind === 'ellipse')
    assert.deepEqual(mixed.center, { x: 12, y: 20 })
    assert.deepEqual(mixed.radius, { x: 25, y: 10 })
    const round = pass.layout(new RoundedRect({ border_radius: px(50) }), request).draw[0]
    assert.ok(round.kind === 'rect')
    assert.deepEqual(round.radius, { x: 50, y: 20 })
    assert.throws(() => pass.layout(new Circle({ radius: px(-1) })), /radius/)
  },

  'resizing changes geometry while explicit pixel strokes remain fixed'() {
    const pass = new LayoutPass()
    const shape = new Line({ from: { x: px(2), y: em(1) }, to: { x: 1, y: 0.5 }, stroke_width: px(3) })
    const small = pass.layout(shape, make_request({ width: exact(40), height: exact(20) }))
    const large = pass.layout(shape, make_request({ width: exact(80), height: exact(40) }))
    assert.equal(small.draw[0].stroke_width, 3); assert.equal(large.draw[0].stroke_width, 3)
    assert.ok(large.draw[0].kind === 'path')
    assert.deepEqual(large.draw[0].commands, [{ kind: 'M', x: 2, y: 16 }, { kind: 'L', x: 80, y: 20 }])
    const fraction = pass.layout(new Circle({ stroke_width: 0.1 }),
      make_request({ width: exact(80), height: exact(40) }))
    assert.equal(fraction.draw[0].stroke_width, 4)
  },

  'directional lines keep centered defaults and resolve positions and spans against their own size'() {
    const pass = new LayoutPass()
    for (const [width, height] of [[200, 100], [300, 200]]) {
      const request = make_request({ width: exact(width), height: exact(height) })
      const cases = [
        [new HLine(), [0, height / 2, width, height / 2]],
        [new VLine(), [width / 2, 0, width / 2, height]],
        [new HLine({ y: 0, lim: [0.25, 0.75] }), [width / 4, 0, width * 0.75, 0]],
        [new VLine({ x: 0, lim: [0.75, 0.25] }), [0, height * 0.75, 0, height / 4]],
        [new HLine({ y: em(2), lim: [px(12), '75%'], font_size: px(10) }), [12, 20, width * 0.75, 20]],
        [new VLine({ x: '25%', lim: ['12px', em(2)], font_size: px(10) }), [width / 4, 12, width / 4, 20]],
      ] as const
      for (const [line, [x1, y1, x2, y2]] of cases) {
        const fragment = pass.layout(line, request), draw = fragment.draw[0] as PathDraw
        assert.deepEqual(fragment.size, { width, height })
        assert.deepEqual(draw.commands, [{ kind: 'M', x: x1, y: y1 }, { kind: 'L', x: x2, y: y2 }])
        assert.equal(draw.fill, 'none')
      }
    }
    const sized = pass.layout(new HLine({ width: px(80), height: px(40), y: 0.25, lim: [0.25, 0.75],
      stroke_width: px(3), stroke: 'red' }), make_request({ width: available(200), height: available(100) }))
    const draw = sized.draw[0] as PathDraw
    assert.deepEqual(draw.commands, [{ kind: 'M', x: 20, y: 10 }, { kind: 'L', x: 60, y: 10 }])
    assert.equal(draw.stroke_width, 3)
    assert.equal(draw.stroke, 'red')
  },

  'directional lines retain local geometry in Graph and opt into data mapping and bounds'() {
    const pass = new LayoutPass(), request = make_request({ width: exact(200), height: exact(100) })
    const h = new HLine({ space: 'data', y: 3, lim: [-2, 6] })
    const v = new VLine({ space: 'data', x: 2, lim: [-1, 7] })
    assert.deepEqual(data_bounds(h), { xlim: [-2, 6], ylim: [3, 3] })
    assert.deepEqual(data_bounds(v), { xlim: [2, 2], ylim: [-1, 7] })
    const local = [new HLine({ y: 0.25, lim: [0.2, 0.8] }), new VLine({ x: 0.75, lim: [0.8, 0.2] })]
    for (const line of local) assert.equal(data_bounds(line), null)
    const coordinates = infer_coordinates([h, v, ...local])
    assert.deepEqual(coordinates.xlim, [-2, 6])
    assert.deepEqual(coordinates.ylim, [-1, 7])
    const graph = pass.layout(new Graph({ children: [h, v, ...local] }), request)
    assert.deepEqual((graph.children[0].fragment.draw[0] as PathDraw).commands,
      [{ kind: 'M', x: 0, y: 50 }, { kind: 'L', x: 200, y: 50 }])
    assert.deepEqual((graph.children[1].fragment.draw[0] as PathDraw).commands,
      [{ kind: 'M', x: 100, y: 100 }, { kind: 'L', x: 100, y: 0 }])
    for (const [index, line] of local.entries()) {
      assert.deepEqual(graph.children[index + 2].fragment.draw, pass.layout(line, request).draw)
    }
    assert.throws(() => pass.layout(h, request), /Data geometry needs a coordinate context/)
    assert.throws(() => pass.layout(v, request), /Data geometry needs a coordinate context/)
  },

  'directional lines accept degenerate spans and snapshot input lengths'() {
    const pass = new LayoutPass(), request = make_request({ width: exact(200), height: exact(100) })
    const start = { value: 12, unit: 'px' as const }, lim: [Length, Length] = [start, 0.75]
    const line = new HLine({ y: 0.25, lim })
    start.value = 99
    lim[1] = 1
    assert.deepEqual((pass.layout(line, request).draw[0] as PathDraw).commands,
      [{ kind: 'M', x: 12, y: 25 }, { kind: 'L', x: 150, y: 25 }])
    for (const Shape of [HLine, VLine]) {
      const dot = pass.layout(new Shape({ lim: [0.5, 0.5], stroke_linecap: 'round', stroke_width: px(4) }), request)
      assert.deepEqual(dot.ink, { x: 98, y: 48, width: 4, height: 4 })
    }
  },

  'directional JSX uses position and span and rejects malformed spans and endpoint overrides'() {
    const pass = new LayoutPass(), request = make_request({ width: exact(200), height: exact(100) })
    for (const [source, expected] of [
      ['<HLine y={0.3} lim={[0.1, 0.9]} />', new HLine({ y: 0.3, lim: [0.1, 0.9] })],
      ['<VLine x={0.7} lim={[0.2, 0.8]} />', new VLine({ x: 0.7, lim: [0.2, 0.8] })],
    ] as const) {
      assert.deepEqual(pass.layout(evaluate(source), request), pass.layout(expected, request))
    }
    for (const Shape of [HLine, VLine]) {
      for (const lim of [[], [0], [0, 1, 2], Array(2), { 0: 0, 1: 1, length: 2 }, null]) {
        assert.throws(() => new Shape({ lim: lim as unknown as readonly [Length, Length] }), /lim needs two endpoints/)
      }
      for (const endpoint of ['from', 'to']) {
        assert.throws(() => evaluate(`<${new Shape().type.name} ${endpoint}={[0, 1]} />`), /use Line for from\/to endpoints/)
      }
    }
  },

  'paths resolve every control point, own source data, and bound curves conservatively'() {
    const pass = new LayoutPass()
    const commands = [move_to(0, 0.5), quad_to(px(5), em(-1), 0.5, 0.5),
      curve_to(0.5, 1, 1, 1, 1, 0.5), line_to(0, 0.5), close_path()]
    const element = new Path({ commands, fill: '#234', stroke_linejoin: 'round' })
    commands.length = 0
    const fragment = pass.layout(element, make_request({ width: exact(100), height: exact(50) }))
    const draw = fragment.draw[0]
    assert.ok(draw.kind === 'path')
    assert.deepEqual(draw.commands[1], { kind: 'Q', x1: 5, y1: -16, x: 50, y: 25 })
    assert.deepEqual(draw.commands[2], { kind: 'C', x1: 50, y1: 50, x2: 100, y2: 50, x: 100, y: 25 })
    assert.deepEqual(draw.bounds, { x: 0, y: -16, width: 100, height: 66 })
    assert.deepEqual(fragment.ink, { x: -0.5, y: -16.5, width: 101, height: 67 })
    assert.equal(Object.isFrozen(draw.commands[1]), FREEZE_ENABLED)
    assert.match(render_svg(fragment), /Q5 -16 50 25C50 50 100 50 100 25/)
    assert.throws(() => pass.layout(new Path({ commands: [line_to(1, 1)] })), /begin with move_to/)
  },

  'polygons close their path and acute miter joins remain within reported ink'() {
    const pass = new LayoutPass()
    const points = [{ x: 0, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }]
    const line = pass.layout(new Polyline({ points }))
    const polygon = pass.layout(new Polygon({ points, stroke_width: px(4), stroke_miterlimit: 8 }))
    assert.ok(line.draw[0].kind === 'path' && polygon.draw[0].kind === 'path')
    assert.equal(line.draw[0].commands.length, 3)
    assert.deepEqual(polygon.draw[0].commands.at(-1), { kind: 'Z' })
    assert.deepEqual(polygon.ink, { x: -16, y: -16, width: 48, height: 48 })
    assert.match(render_svg(polygon), /stroke-miterlimit="8"/)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} shape checks passed.`)

function directional_line_types() {
  const horizontal: HLineProps = { y: em(2), lim: [px(8), '90%'], space: 'data' }
  const vertical: VLineProps = { x: 0.25, lim: [0, 1] }
  new HLine(horizontal)
  new VLine(vertical)
  // @ts-expect-error Horizontal lines use y and lim, not arbitrary endpoints.
  new HLine({ from: [0, 0] })
  // @ts-expect-error Vertical lines use x and lim, not arbitrary endpoints.
  new VLine({ to: [1, 1] })
  // @ts-expect-error HLine's fixed position is y.
  new HLine({ x: 0.5 })
  // @ts-expect-error VLine's fixed position is x.
  new VLine({ y: 0.5 })
  // @ts-expect-error A span needs exactly two lengths.
  new HLine({ lim: [0, 0.5, 1] })
}
