import { FREEZE_ENABLED } from '../src/lib/immutable'
import assert from 'node:assert/strict'
import {
  Arc, Arrow, ArrowHead, Bars, CoordLine, Field, Fill, Graph, LayoutPass, Line, Points,
  Polyline, Ray, Rect, RoundedLine, Segments, Spline, SymField, SymLine, SymPoints,
  SymPoly, SymSpline, data_bounds, evaluate, exact, make_request, px, sample_points,
} from '../src/index'
import type { Coordinate, CoordinatePosition, Element, PathDraw, ProjectionFunction } from '../src/index'

const limits = { xlim: [-5, 5], ylim: [-5, 5] } as const
const fixed = make_request({ width: exact(200), height: exact(100) })
const resized = make_request({ width: exact(400), height: exact(200) })
const commands = (fragment: ReturnType<LayoutPass['layout']>) => (fragment.draw[0] as PathDraw).commands
const graph = (child: Element, projection?: ProjectionFunction) => new Graph({ ...limits, projection, children: child })
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8)

function equivalent(source: Element, expected: Element, projection: ProjectionFunction) {
  const pass = new LayoutPass(), projected = graph(source, projection), cartesian = graph(expected)
  for (const request of [fixed, resized]) {
    assert.deepEqual(pass.layout(projected, request), pass.layout(cartesian, request), source.type.name)
  }
}

const tests: Record<string, () => void> = {
  'every projected point input preserves renamed and additional dimensions across resize'() {
    const spaces: readonly [readonly Coordinate[], ProjectionFunction][] = [
      [[{ theta: 0, r: 2 }, { theta: Math.PI / 3, r: 3 }, { theta: Math.PI / 2, r: 4 }],
        ({ theta, r }) => ({ x: r * Math.cos(theta), y: r * Math.sin(theta) })],
      [[{ x: 1, y: 2, z: -1 }, { x: 2, y: -1, z: 2 }, { x: -2, y: 2, z: 1 }],
        ({ x, y, z }) => ({ x: x + z, y: y - z })],
      [[{ t: 0 }, { t: 1 }, { t: 2 }], ({ t }) => ({ x: t, y: t * t })],
    ]
    for (const [input, project] of spaces) {
      const output = input.map(point => project(point)!)
      const pairs = [
        [new Rect({ pos: input[0], width: px(6), height: px(4), anchor: 'center' }),
          new Rect({ pos: output[0], width: px(6), height: px(4), anchor: 'center' })],
        [new Line({ space: 'data', from: input[0], to: input[1] }),
          new Line({ space: 'data', from: output[0], to: output[1] })],
        [new Polyline({ space: 'data', points: input }), new Polyline({ space: 'data', points: output })],
        [new CoordLine({ points: input }), new CoordLine({ points: output })],
        [new Spline({ points: input }), new Spline({ points: output })],
        [new RoundedLine({ points: input }), new RoundedLine({ points: output })],
        [new Arrow({ points: input, start_head: true }), new Arrow({ points: output, start_head: true })],
        [new Arrow({ from: input[0], to: input[1] }), new Arrow({ from: output[0], to: output[1] })],
        [new Points({ points: input }), new Points({ points: output })],
        [new Segments({ segments: [[input[0], input[1]]] }), new Segments({ segments: [[output[0], output[1]]] })],
        [new Arc({ center: input[0], radius: [px(4), px(6)] }), new Arc({ center: output[0], radius: [px(4), px(6)] })],
        [new ArrowHead({ tip: input[0] }), new ArrowHead({ tip: output[0] })],
        [new Ray({ origin: input[0] }), new Ray({ origin: output[0] })],
      ]
      for (const [source, expected] of pairs) equivalent(source, expected, project)
    }
  },

  'named samples and marker callbacks run once and own complete immutable records'() {
    let sampled = 0, sized = 0, shaped = 0, projected = 0
    const source = { x: 1, y: 2, z: 3 }, samples = [source, null, { x: 2, y: 1, z: NaN }, { x: 2, y: 1, z: 0 }]
    const seen: [number, Coordinate][] = []
    const points = new SymPoints({ tvals: [0, 1, 2, 3],
      f: t => { sampled++; return samples[t] },
      point_size: ({ z }) => { sized++; return px(z + 4) },
      shape: (point, index) => {
        shaped++; seen.push([index, point]); assert.equal(Object.isFrozen(point), FREEZE_ENABLED)
        return new Rect({ fill: 'blue' })
      },
    })
    assert.deepEqual([sampled, sized, shaped], [4, 2, 2])
    assert.deepEqual(seen, [[0, { x: 1, y: 2, z: 3 }], [3, { x: 2, y: 1, z: 0 }]])
    assert.equal(Object.isFrozen(source), false)
    source.z = 99
    const pass = new LayoutPass(), element = graph(points, point => {
      projected++; return { x: point.x + point.z, y: point.y }
    })
    const before = JSON.stringify(element), first = pass.layout(element, fixed)
    assert.deepEqual(first.children[0].fragment.children[0].fragment.size, { width: 7, height: 7 })
    near(first.children[0].fragment.children[0].offset.x, 176.5)
    near(first.children[0].fragment.children[0].offset.y, 26.5)
    const calls = projected
    assert.equal(pass.layout(element, fixed), first)
    assert.equal(projected, calls)
    const larger = pass.layout(element, resized)
    near(larger.children[0].fragment.children[0].offset.x, 356.5)
    near(larger.children[0].fragment.children[0].offset.y, 56.5)
    assert.deepEqual([sampled, sized, shaped], [4, 2, 2])
    assert.equal(JSON.stringify(element), before)
    const other = graph(points, ({ x, y, z }) => ({ x: x - z, y }))
    assert.notDeepEqual(pass.layout(other, fixed), first)
  },

  'parametric curves preserve dimensions and snapshots before projection'() {
    for (const Mark of [SymLine, SymSpline, SymPoly]) {
      let calls = 0
      const source = { t: 0, z: 2 }
      const mark = new Mark({ tvals: [0, 1, 2, 3], f: t => {
        calls++; source.t = t
        return t === 1 ? null : t === 2 ? { t, z: Infinity } : source
      } })
      const expected = new Mark({ tvals: [0, 1, 2, 3], f: t => t === 1 || t === 2 ? null : [t + 2, t] })
      source.z = 99
      equivalent(mark, expected, ({ t, z }) => ({ x: t + z, y: t }))
      assert.equal(calls, 4)
    }
    assert.deepEqual(sample_points({ tvals: [0, 1, 2], f: t => ({ x: t, y: 0, z: t === 1 ? NaN : 1 }) }),
      [{ x: 0, y: 0, z: 1 }, null, { x: 2, y: 0, z: 1 }])
  },

  'source gaps and hidden named samples split paths and keep heads at original endpoints'() {
    const points = [0, 1, 2, 3, 4, 5, 6, 7].map(t => ({ t, z: t === 5 ? Infinity : 0 }))
    const project: ProjectionFunction = ({ t, z }) => {
      assert.ok(Number.isFinite(z))
      return t === 2 ? null : { x: t, y: z }
    }
    const expected = points.map(({ t, z }) => t === 2 || t === 5 ? null : { x: t, y: z })
    for (const Mark of [CoordLine, Spline, RoundedLine, Polyline]) {
      const mark = new Mark({ points, space: 'data' })
      equivalent(mark, new Mark({ points: expected, space: 'data' }), project)
      const fragment = new LayoutPass().layout(graph(mark, project), fixed).children[0].fragment
      assert.equal(commands(fragment).filter(c => c.kind === 'M').length, 3)
    }
    const arrow = new Arrow({ points, start_head: true })
    equivalent(arrow, new Arrow({ points: expected, start_head: true }), project)
    const pass = new LayoutPass()
    assert.equal(pass.layout(graph(arrow, project), fixed).children[0].fragment.draw.length, 5)
    const cut = new Arrow({ points: [points[2], ...points.slice(3), null], start_head: true })
    assert.equal(pass.layout(graph(cut, project), fixed).children[0].fragment.draw.length, 2)
    const markers = new Points({ points })
    assert.equal(pass.layout(graph(markers, project), fixed).children[0].fragment.children.length, 6)
  },

  'hidden or nonfinite named endpoints omit isolated geometry'() {
    const pass = new LayoutPass(), project: ProjectionFunction = ({ t }) => t === 1 ? null : { x: t, y: t }
    for (const point of [{ t: 1 }, { t: 0, z: Infinity }] as readonly Coordinate[]) {
      for (const mark of [new Line({ space: 'data', from: point, to: { t: 2 } }),
        new Segments({ segments: [[{ t: 2 }, point]] }), new ArrowHead({ tip: point }),
        new Ray({ origin: point }), new Arc({ center: point, radius: px(3) })]) {
        const fragment = pass.layout(graph(mark, project), fixed).children[0].fragment
        assert.ok(fragment.draw.every(draw => draw.kind === 'path' && draw.commands.length === 0), mark.type.name)
      }
    }
  },

  'explicit Fill boundaries preserve different named spaces and split paired gaps'() {
    const points = Array.from({ length: 8 }, (_, t) => ({ t, h: 3 }))
    const boundary = points.map(({ t }) => ({ x: t, y: 0, z: t === 5 ? NaN : 1 }))
    const project: ProjectionFunction = point => 't' in point
      ? { x: point.t, y: point.h } : point.x === 2 ? null : { x: point.x, y: point.y + point.z }
    const output = points.map(({ t, h }) => ({ x: t, y: h }))
    const lower = boundary.map(({ x, y, z }) => x === 2 || x === 5 ? null : { x, y: y + z })
    const fill = new Fill({ points, boundary })
    equivalent(fill, new Fill({ points: output, boundary: lower }), project)
    const fragment = new LayoutPass().layout(graph(fill, project), fixed).children[0].fragment
    assert.equal(commands(fragment).filter(c => c.kind === 'Z').length, 3)
    assert.throws(() => new LayoutPass().layout(graph(new Fill({ points, boundary: [] }), project)), /matching lengths/)
  },

  'axis arithmetic rejects named sources and extra dimensions before synthesizing geometry'() {
    const pass = new LayoutPass(), project: ProjectionFunction = () => ({ x: 0, y: 0 })
    for (const point of [{ t: 1 }, { x: 1, y: 2, z: 3 }] as readonly Coordinate[]) {
      assert.throws(() => pass.layout(graph(new Fill({ points: [point], boundary: 0 }), project)), /scalar boundary.*Cartesian/)
      assert.throws(() => new Field({ vectors: [{ point: point as never, vector: [1, 2] }] }), /Cartesian/)
      assert.throws(() => new Field({ vectors: [{ point: [0, 0], vector: point as never }] }), /Cartesian/)
      assert.throws(() => new SymField({ f: () => point as never }), /Cartesian/)
    }
    assert.throws(() => pass.layout(graph(new Arc({ center: { t: 1 }, radius: 1 }), project)), /radii need local lengths/)
    const seen: Coordinate[] = []
    pass.layout(graph(new Bars({ values: [2], positions: [1], bar_width: 0.5 }), point => {
      seen.push(point); return { x: point.x + point.y, y: point.y }
    }), fixed)
    assert.equal(seen.length, 2)
    assert.ok(seen.every(point => Object.keys(point).sort().join() === 'x,y'))
  },

  'local lengths bypass projection and named lengths fail before callbacks'() {
    const project: ProjectionFunction = () => { throw new Error('unexpected projection') }
    const points = [[px(4), px(8)], { x: px(8), y: px(16) }] as const
    const pass = new LayoutPass()
    for (const mark of [new CoordLine({ points }), new Points({ points }), new Polyline({ space: 'data', points })]) {
      assert.deepEqual(pass.layout(graph(mark, project), fixed).children[0].fragment,
        pass.layout(graph(mark), fixed).children[0].fragment)
    }
    for (const value of [{ theta: 0, r: px(3) }, { x: px(1), y: px(2), z: 3 }, { x: undefined, y: 2 }]) {
      let called = false
      assert.throws(() => new Points({ points: [value as never], shape: () => { called = true; return new Rect() } }),
        /Cartesian|must be a number or local length/)
      assert.equal(called, false)
    }
    for (const point of [{ t: 0 }, { x: 1, y: 2, z: 3 }] as readonly Coordinate[]) {
      assert.throws(() => pass.layout(graph(new Points({ points: [point], space: 'local' }), project)), /Local positions/)
    }
  },

  'sample validation checks all dimensions and distinguishes malformed data from gaps'() {
    for (const value of [{ t: 1, r: '2' }, { t: NaN, r: {} }, { t: 1, r: px(2) }, {}, [1, 2, 3]]) {
      assert.throws(() => sample_points({ f: () => value as never, samples: 1 }),
        (error: unknown) => error instanceof Error && /Sample 0 at t=0/.test(error.message)
          && error.cause instanceof TypeError)
      assert.throws(() => new Points({ points: [value as never] }))
    }
    const line = new CoordLine({ points: [{ x: 100, y: 100, z: Infinity }, { x: 1, y: 2, z: 0 }, { x: 3, y: 4, z: 0 }] })
    assert.deepEqual(data_bounds(line), { xlim: [1, 3], ylim: [2, 4] })
    assert.throws(() => data_bounds(new CoordLine({ points: [{ theta: 0, r: 1 }] })), /projection with explicit limits/)
  },

  'JSX forwards complete coordinates and expands tuples to x and y'() {
    const source = evaluate(`
      const point = {theta: 0, r: 2}
      return <Graph xlim={[-5, 5]} ylim={[-5, 5]} projection={({theta, r}) => ({x: r * cos(theta), y: r * sin(theta)})}>
        <Points points={[point]} point-size={({r}) => px(r + 4)} />
        <SymLine f={t => ({theta: t, r: 2})} tvals={[0, 1]} />
      </Graph>
    `)
    const expected = new Graph({ ...limits, children: [new Points({ points: [[2, 0]], point_size: px(6) }),
      new SymLine({ tvals: [0, 1], f: t => [2 * Math.cos(t), 2 * Math.sin(t)] })] })
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(source, fixed), pass.layout(expected, fixed))
    const seen: Coordinate[] = []
    pass.layout(graph(new Points({ points: [[1, 2], { t: 3 }] }), point => {
      seen.push(point); return { x: 0, y: 0 }
    }), fixed)
    assert.deepEqual(seen, [{ x: 1, y: 2 }, { t: 3 }])
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`) }
console.log(`${Object.keys(tests).length} named mark checks passed.`)

// Strict consumer checks: numeric callback fields follow the supplied records;
// local Cartesian callbacks still see their original lengths.
function named_mark_types() {
  new Points({ points: [{ theta: 1, r: 2 }], point_size: ({ r }) => px(r * 2),
    shape: ({ theta }) => new Rect({ width: px(theta + 1) }) })
  new Points({ points: [[1, 2]], point_size: ({ x, y }) => px(x + y) })
  new Points({ points: [{ x: px(2), y: px(3) }], point_size: ({ x, y }) => [x, y] })
  new SymPoints({ f: t => ({ theta: t, r: 2 }), point_size: ({ r }) => px(r * 2) })
  new Points({ points: [{ x: 1, y: 2, z: 3 }], shape: point => {
    // @ts-expect-error Callback records are immutable.
    point.z = 4
    return new Rect({ width: px(point.z) })
  } })
  // @ts-expect-error Named dimensions must be numeric.
  new CoordLine({ points: [{ theta: 1, r: px(2) }] })
  // @ts-expect-error Parametric data samples cannot use local lengths.
  new SymLine({ f: t => ({ t, r: px(2) }) })
  const position: CoordinatePosition = { x: 1, y: 2, z: 3 }
  new Line({ space: 'data', from: position, to: { t: 1 } })
}
