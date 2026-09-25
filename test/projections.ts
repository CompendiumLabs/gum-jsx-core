import assert from 'node:assert/strict'
import {
  Arrow, ArrowHead, Arc, Bars, CoordLine, Element, Field, Fill, Graph, LayoutPass,
  Line, Points, Polyline, Projection, Ray, Rect, RoundedLine, Segments, Spline,
  coordinate_point, copy_coordinates, evaluate, exact, infer_coordinates, make_measure, make_request, map_point,
  px, unmap_point,
} from '../src/index'
import type { PathDraw, ProjectionFunction } from '../src/index'

const fixed = make_request({ width: exact(200), height: exact(100) })
const limits = { xlim: [0, 10], ylim: [0, 10] } as const
const shear: ProjectionFunction = ([x, y]) => [x + y, y]
const graph = (child: Element, projection: ProjectionFunction = shear) =>
  new Graph({ ...limits, projection, children: child })
const commands = (fragment: ReturnType<LayoutPass['layout']>) => (fragment.draw[0] as PathDraw).commands
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-8); }

const tests: Record<string, () => void> = {
  'polar projection maps pairs before viewport limits and flips'() {
    const polar: ProjectionFunction = ([theta, r]) => [r * Math.cos(theta), r * Math.sin(theta)]
    const fragment = new LayoutPass().layout(new Graph({ projection: polar,
      xlim: [-1, 1], ylim: [-1, 1], children: new CoordLine({ points: [[0, 1], [Math.PI / 2, 1]] }) }), fixed)
    const path = commands(fragment.children[0].fragment)
    near((path[0] as { x: number }).x, 200)
    near((path[0] as { y: number }).y, 50)
    near((path[1] as { x: number }).x, 100)
    near((path[1] as { y: number }).y, 0)
  },
  'ordinary geometry maps supplied points without adding samples'() {
    const pass = new LayoutPass()
    const input = [[1, 2], [3, 4], [5, 1]] as const
    const output = [[3, 2], [7, 4], [6, 1]] as const
    const pairs = [
      [new Line({ from: input[0], to: input[1], space: 'data' }),
        new Line({ from: output[0], to: output[1], space: 'data' })],
      [new Polyline({ points: input, space: 'data' }), new Polyline({ points: output, space: 'data' })],
      [new CoordLine({ points: input }), new CoordLine({ points: output })],
      [new Spline({ points: input }), new Spline({ points: output })],
      [new RoundedLine({ points: input }), new RoundedLine({ points: output })],
      [new Arrow({ points: input }), new Arrow({ points: output })],
      [new Points({ points: input, point_size: px(8) }), new Points({ points: output, point_size: px(8) })],
      [new Segments({ segments: [[input[0], input[1]]] }), new Segments({ segments: [[output[0], output[1]]] })],
      [new ArrowHead({ tip: input[0] }), new ArrowHead({ tip: output[0] })],
      [new Ray({ origin: input[0] }), new Ray({ origin: output[0] })],
      [new Field({ vectors: [{ point: [1, 2], vector: [2, 2] }] }),
        new Field({ vectors: [{ point: [3, 2], vector: [4, 2] }] })],
      [new Fill({ points: input, boundary: 0 }),
        new Fill({ points: output, boundary: [[1, 0], [3, 0], [5, 0]] })],
    ]
    for (const [a, b] of pairs) {
      const projected = pass.layout(graph(a), fixed).children[0].fragment
      const cartesian = pass.layout(new Graph({ ...limits, children: b }), fixed).children[0].fragment
      assert.deepEqual(projected, cartesian, a.type.name)
    }
  },
  'annotations project anchors while dimensions and unpositioned children remain local'() {
    const child = new Rect({ x: 1, y: 2, width: px(10), height: px(6), anchor: 'center' })
    const pass = new LayoutPass(), source = graph(child)
    const a = pass.layout(source, fixed).children[0]
    assert.deepEqual(a.offset, { x: 55, y: 77 })
    const b = pass.layout(source, make_request({ width: exact(400), height: exact(200) })).children[0]
    assert.deepEqual(b.offset, { x: 115, y: 157 })
    assert.deepEqual(a.fragment.size, b.fragment.size)
    assert.deepEqual(pass.layout(graph(new Rect()), fixed).children[0].offset, { x: 0, y: 0 })
    assert.deepEqual(pass.layout(graph(new Rect({ x: px(7) })), fixed).children[0].offset, { x: 7, y: 0 })
  },
  'local geometry and tagged pairs bypass projection; mixed pairs are rejected'() {
    const pass = new LayoutPass()
    const points = [[1, 2], [3, 4]] as const
    const local = new CoordLine({ points, space: 'local' })
    assert.deepEqual(pass.layout(graph(local), fixed).children[0].fragment, pass.layout(local, fixed))
    const tagged = new CoordLine({ points: [[px(10), px(20)], ['50%', '25%']] })
    assert.deepEqual(commands(pass.layout(graph(tagged), fixed).children[0].fragment), [
      { kind: 'M', x: 10, y: 20 }, { kind: 'L', x: 100, y: 25 },
    ])
    assert.throws(() => pass.layout(graph(new Points({ points: [[1, px(2)]] })), fixed), /two data numbers/)
  },
  'projection identity participates in caching and survives source copies'() {
    const pass = new LayoutPass(), child = new CoordLine({ points: [[1, 2], [3, 4]] })
    const a = graph(child), b = graph(child, ([x, y]) => [x - y, y])
    const first = pass.layout(a, fixed).children[0].fragment
    assert.notDeepEqual(first, pass.layout(b, fixed).children[0].fragment)
    const copy = new Element(a.type, a.props)
    assert.equal(pass.layout(copy, fixed).children[0].fragment, first)
    assert.equal(copy.props.projection, a.props.projection)
    assert.ok(Object.isFrozen(a.props.projection))
  },
  'nested graphs establish their own coordinate frame'() {
    const inner = new Graph({ ...limits, children: new CoordLine({ points: [[1, 2], [3, 4]] }) })
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(graph(inner), fixed).children[0].fragment, pass.layout(inner, fixed))
  },
  'null projection results hide markers and split paths without adding heads at cuts'() {
    const project: ProjectionFunction = ([x, y]) => x === 2 ? null : [x, y]
    const points = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] as const
    const pass = new LayoutPass()
    const path = commands(pass.layout(graph(new CoordLine({ points }), project), fixed).children[0].fragment)
    assert.deepEqual(path.map(c => c.kind), ['M', 'L', 'M', 'L'])
    const arrow = pass.layout(graph(new Arrow({ points, start_head: true }), project), fixed).children[0].fragment
    assert.equal(arrow.draw.length, 4) // Two shafts, one head at each original endpoint.
    const cut_end = pass.layout(graph(new Arrow({ points: points.slice(0, 3) }), project), fixed).children[0].fragment
    assert.equal(cut_end.draw.length, 1)
    const markers = pass.layout(graph(new Points({ points }), project), fixed).children[0].fragment
    assert.equal(markers.children.length, 4)
    const hidden = pass.layout(graph(new Rect({ x: 2, y: 0 }), project), fixed).children[0].fragment
    assert.deepEqual(hidden.size, { width: 0, height: 0 })
    for (const child of [new Segments({ segments: [[points[1], points[2]]] }),
      new Bars({ values: [0], positions: [2], bar_width: 0 }),
      new Arc({ center: points[2], radius: px(4) }), new Ray({ origin: points[2] }),
      new ArrowHead({ tip: points[2] })]) {
      const fragment = pass.layout(graph(child, project), fixed).children[0].fragment
      assert.ok(fragment.draw.every(draw => draw.kind === 'path' && draw.commands.length === 0))
    }
  },
  'core coordinate helpers validate projection results and reject unsupported inverses'() {
    const coordinates = copy_coordinates({ ...limits, flip_x: true, flip_y: false, projection: new Projection(shear) })
    assert.deepEqual(map_point([1, 2], coordinates, { width: 200, height: 100 }), { x: 140, y: 20 })
    assert.deepEqual(coordinate_point([1, 2], { width: 200, height: 100 }, make_measure(), coordinates), { x: 140, y: 20 })
    assert.throws(() => unmap_point([140, 20], coordinates, { width: 200, height: 100 }), /inverse/)
    assert.throws(() => new Graph({ projection: shear }), /explicit xlim and ylim/)
    assert.throws(() => new Graph({ xlim: [0, 1], projection: shear }), /explicit xlim and ylim/)
    assert.doesNotThrow(() => new Graph({ coord: [0, 0, 1, 1], projection: shear }))
    for (const value of [[1], [NaN, 0], [1, Infinity], undefined, { x: 1, y: 2 }]) {
      const invalid = new Projection((() => value) as unknown as ProjectionFunction)
      assert.throws(() => invalid.project([0, 0]), /coordinate pair|finite/)
    }
  },
  'evaluated JSX can reuse a core Projection as well as a callback'() {
    const source = evaluate(`
      const projection = new Projection(([x, y]) => [x + y, y])
      return <Graph projection={projection} xlim={[0, 10]} ylim={[0, 10]}>
        <CoordLine points={[[1, 2], [3, 4]]} />
      </Graph>
    `)
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(source, fixed), pass.layout(graph(new CoordLine({ points: [[1, 2], [3, 4]] })), fixed))
    assert.throws(() => source.props.projection.project([1, 2, 3]), /coordinate pair/)
  },
  'Line and Polyline keep local defaults and require an explicit data context'() {
    const pass = new LayoutPass()
    for (const Shape of [Line, Polyline]) {
      const props = { from: [0.2, 0.3], to: [0.8, 0.7], points: [[0.2, 0.3], [0.8, 0.7]] } as const
      const local = new Shape(props)
      assert.deepEqual(pass.layout(graph(local), fixed).children[0].fragment, pass.layout(local, fixed))
      assert.deepEqual(pass.layout(graph(new Shape({ ...props, space: 'local' })), fixed).children[0].fragment,
        pass.layout(local, fixed))
      assert.throws(() => pass.layout(new Shape({ ...props, space: 'data' }), fixed), /coordinate context/)
      assert.throws(() => pass.layout(new Shape({ space: 'invalid' as 'local' }), fixed), /Unknown geometry space/)
      const tagged = new Shape({ space: 'data', from: [px(10), px(20)], to: ['50%', '25%'],
        points: [[px(10), px(20)], ['50%', '25%']] })
      assert.deepEqual(commands(pass.layout(graph(tagged), fixed).children[0].fragment), [
        { kind: 'M', x: 10, y: 20 }, { kind: 'L', x: 100, y: 25 },
      ])
      const mixed = new Shape({ space: 'data', from: [1, px(2)], points: [[1, px(2)]] })
      assert.throws(() => pass.layout(graph(mixed), fixed), /two data numbers/)
    }
  },
  'data Line and Polyline contribute bounds while local shapes do not'() {
    const line = new Line({ space: 'data', from: [10, -5], to: { x: 20, y: 5 } })
    const polyline = new Polyline({ space: 'data', points: [[5, 3], { x: 30, y: 8 }, [px(99), px(99)]] })
    const local = new Line({ from: [-100, -100], to: [100, 100] })
    const coordinates = infer_coordinates([line, polyline, local])
    assert.deepEqual(coordinates.xlim, [5, 30])
    assert.deepEqual(coordinates.ylim, [-5, 8])
    assert.deepEqual(infer_coordinates([new Line(), new Polyline({ points: [[10, 20], [30, 40]] })]).xlim, [0, 1])
    const fragment = new LayoutPass().layout(new Graph({ children: line }), fixed)
    assert.deepEqual(commands(fragment.children[0].fragment), [{ kind: 'M', x: 0, y: 100 }, { kind: 'L', x: 200, y: 0 }])
  },
  'projected lines handle invisible endpoints and break polylines at invisible vertices'() {
    const project: ProjectionFunction = ([x, y]) => x === 2 ? null : [x, y]
    const pass = new LayoutPass()
    for (const endpoints of [[[1, 0], [2, 0]], [[2, 0], [1, 0]], [[2, 0], [2, 1]]] as const) {
      const line = new Line({ from: endpoints[0], to: endpoints[1], space: 'data' })
      assert.deepEqual(commands(pass.layout(graph(line, project), fixed).children[0].fragment), [])
    }
    const points = [[2, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [2, 0]] as const
    const polyline = new Polyline({ points, space: 'data', stroke_width: px(3) })
    const fragment = pass.layout(graph(polyline, project), fixed).children[0].fragment
    assert.deepEqual(commands(fragment), [
      { kind: 'M', x: 0, y: 100 }, { kind: 'L', x: 20, y: 100 },
      { kind: 'M', x: 60, y: 100 }, { kind: 'L', x: 80, y: 100 },
    ])
    const resized = pass.layout(graph(polyline, project), make_request({ width: exact(400), height: exact(200) })).children[0].fragment
    assert.equal(resized.draw[0].stroke_width, 3)
    assert.deepEqual(commands(resized).at(-1), { kind: 'L', x: 160, y: 200 })
    const other = pass.layout(graph(polyline, shear), fixed).children[0].fragment
    assert.equal(commands(other).length, points.length)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} projection checks passed.`)
