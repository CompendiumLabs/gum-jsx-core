import { FREEZE_ENABLED } from '../src/lib/immutable'
import assert from 'node:assert/strict'
import {
  Polyline, Graph, HAxis, HMesh, LayoutPass, Points, Projection, Rect, SymArrow,
  VAxis, VMesh, evaluate, exact, log_projection, make_request, polar_projection, px, render_svg,
} from '../src/index'
import type { Coordinate, LogProjectionOptions, PathDraw, PolarProjectionOptions } from '../src/index'

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)
function near_point(actual: Coordinate | null, x: number, y: number) {
  assert.ok(actual)
  near(actual.x, x); near(actual.y, y)
}

const tests: Record<string, () => void> = {
  'polar maps named radians, signed radii, and complete turns'() {
    const projection = polar_projection()
    near_point(projection.project({ theta: 0, r: 2 }), 2, 0)
    near_point(projection.project({ theta: Math.PI / 2, r: 2 }), 0, 2)
    near_point(projection.project({ theta: Math.PI, r: 2 }), -2, 0)
    near_point(projection.project({ theta: -Math.PI / 2, r: 2 }), 0, -2)
    near_point(projection.project({ theta: 2 * Math.PI, r: 2 }), 2, 0)
    near_point(projection.project({ theta: 0, r: -2, weight: 5 }), -2, 0)
    near_point(projection.project({ theta: 1, r: 0 }), 0, 0)
  },
  'polar orientation uses a fixed offset and an optional clockwise direction'() {
    const options: PolarProjectionOptions = { degrees: true, offset: 90, clockwise: true }
    const compass = polar_projection(options)
    near_point(compass.project({ theta: 0, r: 2 }), 0, 2)
    near_point(compass.project({ theta: 90, r: 2 }), 2, 0)
    near_point(compass.project({ theta: 180, r: 2 }), 0, -2)
    near_point(compass.project({ theta: 450, r: 2 }), 2, 0)
    near_point(polar_projection({ offset: Math.PI / 2 }).project({ theta: Math.PI / 2, r: 2 }), -2, 0)
    near_point(polar_projection({ clockwise: true }).project({ theta: Math.PI / 2, r: 2 }), 0, -2)
    // Reducing turns before adding the offset keeps finite angles from overflowing.
    const huge = polar_projection({ offset: Number.MAX_VALUE }).project({ theta: Number.MAX_VALUE, r: 1 })!
    near(Math.hypot(huge.x, huge.y), 1)
  },
  'log maps decades and selectable axes with arbitrary valid bases'() {
    const projection = log_projection()
    assert.deepEqual(projection.project({ x: 1, y: 1000 }), { x: 0, y: 3 })
    near_point(projection.project({ x: 0.01, y: 100 }), -2, 2)
    near_point(log_projection({ axes: 'x' }).project({ x: 100, y: -2 }), 2, -2)
    near_point(log_projection({ axes: 'y' }).project({ x: 0, y: 100 }), 0, 2)
    near_point(log_projection({ base: 2 }).project({ x: 8, y: 0.25 }), 3, -2)
    near_point(log_projection({ base: Math.E }).project({ x: Math.exp(2), y: Math.exp(-3) }), 2, -3)
    near_point(log_projection({ base: 0.5 }).project({ x: 4, y: 0.125 }), -2, 3)
    near_point(projection.project({ x: 10, y: 100, temperature: 4 }), 1, 2)
    assert.ok(projection.project({ x: Number.MIN_VALUE, y: Number.MAX_VALUE }))
  },
  'log hides only nonpositive coordinates on logged axes'() {
    for (const value of [0, -0, -1]) {
      assert.equal(log_projection().project({ x: value, y: 1 }), null)
      assert.equal(log_projection().project({ x: 1, y: value }), null)
      near_point(log_projection({ axes: 'x' }).project({ x: 10, y: value }), 1, value)
      near_point(log_projection({ axes: 'y' }).project({ x: value, y: 10 }), value, 1)
    }
  },
  '2D helpers reject malformed coordinates and options'() {
    const polar_inputs: Coordinate[] = [{ x: 1, y: 2 }, { theta: 0 }, { r: 1 }]
    const log_inputs: Coordinate[] = [{ theta: 0, r: 1 }, { x: 1 }, { y: 1 }]
    for (const point of polar_inputs) {
      assert.throws(() => polar_projection().project(point), /needs theta and r/)
    }
    for (const point of log_inputs) {
      assert.throws(() => log_projection().project(point), /needs x and y/)
    }
    for (const offset of [NaN, Infinity]) assert.throws(() => polar_projection({ offset }), /offset/)
    for (const option of ['degrees', 'clockwise']) {
      assert.throws(() => polar_projection({ [option]: 'true' } as never), /booleans/)
    }
    for (const base of [0, -1, 1, NaN, Infinity]) assert.throws(() => log_projection({ base }), /base/)
    assert.throws(() => log_projection({ axes: 'z' } as never), /axes/)
    assert.throws(() => polar_projection().project({ theta: NaN, r: 1 }), /finite/)
    assert.throws(() => log_projection().project({ x: 1, y: Infinity }), /finite/)
    assert.throws(() => polar_projection().project({ theta: 0, r: '1' } as never), /number/)
    assert.throws(() => log_projection().project({ x: 1, y: 1, extra: NaN }), /finite/)
  },
  '2D factories snapshot options and work in evaluated JSX'() {
    const options = { degrees: true, offset: 90, clockwise: true }
    const polar = polar_projection(options)
    options.degrees = false; options.offset = 0; options.clockwise = false
    near_point(polar.project({ theta: 90, r: 2 }), 2, 0)
    const logarithmic: { axes: 'x' | 'y'; base: number } = { axes: 'x', base: 2 }
    const log = log_projection(logarithmic)
    logarithmic.axes = 'y'; logarithmic.base = 10
    near_point(log.project({ x: 8, y: -2 }), 3, -2)
    for (const projection of [polar, log]) {
      assert.ok(projection instanceof Projection)
      assert.equal(Object.isFrozen(projection), FREEZE_ENABLED)
    }
    const source = evaluate(`
      return <Graph projection={polar_projection({degrees: true})} xlim={[-2, 2]} ylim={[-2, 2]}>
        <SymArrow f={theta => ({theta, r: 1})} tvals={[0, 90, 180]} />
      </Graph>
    `)
    const expected = new Graph({ xlim: [-2, 2], ylim: [-2, 2], children:
      new SymArrow({ f: theta => ({ x: Math.cos(theta * Math.PI / 180), y: Math.sin(theta * Math.PI / 180) }),
        tvals: [0, 90, 180] }) })
    const pass = new LayoutPass()
    for (const width of [200, 400]) {
      const request = make_request({ width: exact(width), height: exact(width) })
      assert.deepEqual(pass.layout(source, request), pass.layout(expected, request))
    }
    const config: LogProjectionOptions = { axes: 'both', base: 10 }
    assert.deepEqual(evaluate('return log_projection()').project({ x: 10, y: 100 }),
      log_projection(config).project({ x: 10, y: 100 }))
  },
  'manual logarithmic axes and grids align with projected marks across resize'() {
    const ticks = [[0, '1'], [1, '10'], [2, '100'], [3, '1000']] as const
    const axes = [new HMesh({ lim: [0, 3], ticks }), new VMesh({ lim: [0, 3], ticks }),
      new HAxis({ lim: [0, 3], ticks }), new VAxis({ lim: [0, 3], ticks })]
    const points = [1, 10, 100, 1000].map(value => ({ x: value, y: value }))
    const projected = [0, 1, 2, 3].map(value => ({ x: value, y: value }))
    const source = new Graph({ projection: log_projection(), xlim: [0, 3], ylim: [0, 3], children: [
      ...axes, new Polyline({ points }), new Points({ points, point_size: px(6) }),
      new Rect({ pos: points[1], width: px(4), height: px(4) }),
    ] })
    const expected = new Graph({ xlim: [0, 3], ylim: [0, 3], children: [
      ...axes, new Polyline({ points: projected }), new Points({ points: projected, point_size: px(6) }),
      new Rect({ pos: projected[1], width: px(4), height: px(4) }),
    ] })
    const pass = new LayoutPass()
    for (const width of [200, 400]) {
      const request = make_request({ width: exact(width), height: exact(width / 2) })
      assert.deepEqual(pass.layout(source, request), pass.layout(expected, request))
    }
  },
  'log domain gaps split sampled arrows and omit markers and annotations'() {
    const points = [[1, 1], [10, 10], [0, 5], [100, 100], [1000, 1000]] as const
    const source = new Graph({ projection: log_projection(), xlim: [0, 3], ylim: [0, 3], children: [
      new SymArrow({ f: t => points[t], tvals: [0, 1, 2, 3, 4], start_head: true }),
      new Points({ points }), new Rect({ pos: points[2], width: px(4), height: px(4) }),
    ] })
    const fragment = new LayoutPass().layout(source, make_request({ width: exact(300), height: exact(300) }))
    const paths = fragment.children[0].fragment.draw as readonly PathDraw[]
    assert.equal(paths.length, 4) // Two shafts, with heads only at the original endpoints.
    assert.equal(fragment.children[1].fragment.children.length, 4)
    assert.deepEqual(fragment.children[2].fragment.size, { width: 0, height: 0 })
    assert.doesNotMatch(render_svg(fragment), /NaN|Infinity/)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} 2D projection checks passed.`)
