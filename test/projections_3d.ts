import assert from 'node:assert/strict'
import {
  CoordLine, Graph, LayoutPass, Points, Rect, SymLine, evaluate, exact, make_request, px,
  isometric_projection, orthographic_projection, perspective_projection,
} from '../src/index'
import type { Coordinate, Point3, Projection, PerspectiveProjectionOptions } from '../src/index'

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`)
const near_point = (actual: Coordinate | null, x: number, y: number) => {
  assert.ok(actual)
  near(actual.x, x); near(actual.y, y)
}
const eye = { x: 0, y: -4, z: 0 }

const tests: Record<string, () => void> = {
  'isometric axes have equal unit lengths and 120-degree separation'() {
    const projection = isometric_projection()
    const axes = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }]
      .map(point => projection.project(point)!)
    near_point(axes[0], Math.sqrt(3) / 2, -0.5)
    near_point(axes[1], -Math.sqrt(3) / 2, -0.5)
    near_point(axes[2], 0, 1)
    for (let i = 0; i < axes.length; i++) {
      near(Math.hypot(axes[i].x, axes[i].y), 1)
      const next = axes[(i + 1) % axes.length]
      near(axes[i].x * next.x + axes[i].y * next.y, -0.5)
    }
    near_point(projection.project({ x: 3, y: 3, z: 3 }), 0, 0)
  },
  'orthographic angles describe the direction of sight and retain orientation at the poles'() {
    const point = { x: 2, y: 3, z: 4 }
    near_point(orthographic_projection({ azimuth: 0, elevation: 0 }).project(point), -3, 4)
    near_point(orthographic_projection({ azimuth: 90, elevation: 0 }).project(point), 2, 4)
    near_point(orthographic_projection({ azimuth: 90, elevation: 90 }).project(point), 2, -3)
    near_point(orthographic_projection({ azimuth: 90, elevation: -90 }).project(point), 2, 3)
    assert.deepEqual(orthographic_projection().project(point),
      orthographic_projection({ azimuth: 45, elevation: 30 }).project(point))
    assert.deepEqual(orthographic_projection({ azimuth: 450 }).project(point),
      orthographic_projection({ azimuth: 90 }).project(point))
    const orthographic = orthographic_projection({ azimuth: 45, elevation: Math.atan(1 / Math.sqrt(2)) * 180 / Math.PI })
    const a = orthographic.project(point)!, b = isometric_projection().project(point)!
    near(b.x, a.x * Math.sqrt(1.5)); near(b.y, a.y * Math.sqrt(1.5))
  },
  'orthographic projection preserves the view plane and ignores distance along sight'() {
    const projection = orthographic_projection({ azimuth: 90, elevation: 0 })
    near_point(projection.project({ x: 3, y: -100, z: 4 }), 3, 4)
    near_point(projection.project({ x: 3, y: 100, z: 4 }), 3, 4)
    const azimuth = 32, elevation = -21
    const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180
    const view = orthographic_projection({ azimuth, elevation })
    const point = { x: 2, y: 3, z: 4 }, projected = view.project(point)!
    near_point(view.project({ x: point.x + 10 * Math.cos(el) * Math.cos(az),
      y: point.y + 10 * Math.cos(el) * Math.sin(az), z: point.z + 10 * Math.sin(el) }), projected.x, projected.y)
  },
  'perspective uses eye-relative depth, focal length, and an explicit up vector'() {
    const projection = perspective_projection({ eye })
    near_point(projection.project({ x: 0, y: 0, z: 0 }), 0, 0)
    near_point(projection.project({ x: 2, y: 0, z: 3 }), 0.5, 0.75)
    near_point(projection.project({ x: 2, y: 4, z: 3 }), 0.25, 0.375)
    near_point(perspective_projection({ eye, focal_length: 2 }).project({ x: 2, y: 0, z: 3 }), 1, 1.5)
    const translated = perspective_projection({ eye: { x: 10, y: 16, z: 30 }, target: { x: 10, y: 20, z: 30 } })
    near_point(translated.project({ x: 12, y: 20, z: 33 }), 0.5, 0.75)
    const overhead = perspective_projection({ eye: { x: 0, y: 0, z: 4 }, up: { x: 0, y: 1, z: 0 } })
    near_point(overhead.project({ x: 1, y: 2, z: 0 }), 0.25, 0.5)
    const oblique = perspective_projection({ eye: { x: 1, y: 1, z: 1 } })
    near_point(oblique.project({ x: 1, y: 0, z: 0 }), -Math.sqrt(3 / 8), -1 / (2 * Math.sqrt(2)))
    const same_direction = perspective_projection({ eye, up: { x: 0, y: 0, z: 1000 } })
    assert.deepEqual(same_direction.project({ x: 2, y: 0, z: 3 }), projection.project({ x: 2, y: 0, z: 3 }))
  },
  'perspective hides points at or behind the near plane without dividing by zero'() {
    const projection = perspective_projection({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 1, z: 0 }, near: 0.5 })
    for (const y of [-2, 0, 0.25, 0.5]) assert.equal(projection.project({ x: 1, y, z: 1 }), null)
    near_point(projection.project({ x: 1, y: 1, z: 1 }), 1, 1)
    const defaults = perspective_projection({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 1, z: 0 } })
    assert.equal(defaults.project({ x: 1, y: 0.01, z: 1 }), null)
    assert.ok(defaults.project({ x: 1, y: 0.02, z: 1 }))
  },
  'camera helpers require xyz records and reject invalid or degenerate options'() {
    const incomplete: Coordinate[] = [{ x: 1, y: 2 }, { x: 1, z: 2 }, { y: 1, z: 2 }, { theta: 1, r: 2 }]
    for (const projection of [isometric_projection(), orthographic_projection(), perspective_projection({ eye })]) {
      for (const point of incomplete) {
        assert.throws(() => projection.project(point), /needs x, y, and z/)
      }
      assert.ok(projection.project({ x: 1, y: 2, z: 3, temperature: 4 }))
      assert.throws(() => projection.project({ x: 1, y: 2, z: NaN }), /finite/)
    }
    for (const azimuth of [NaN, Infinity]) assert.throws(() => orthographic_projection({ azimuth }), /azimuth/)
    for (const elevation of [NaN, Infinity, -91, 91]) assert.throws(() => orthographic_projection({ elevation }), /elevation/)
    for (const key of ['focal_length', 'near'] as const) {
      for (const value of [0, -1, NaN, Infinity]) assert.throws(() => perspective_projection({ eye, [key]: value }), new RegExp(key))
    }
    assert.throws(() => perspective_projection({ eye, target: eye }), /target - eye must be nonzero/)
    assert.throws(() => perspective_projection({ eye, up: { x: 0, y: 0, z: 0 } }), /up must be nonzero/)
    for (const sign of [-1, 1]) {
      assert.throws(() => perspective_projection({ eye, up: { x: 0, y: sign, z: 0 } }), /up must not be parallel/)
    }
    for (const key of ['eye', 'target', 'up'] as const) {
      assert.throws(() => perspective_projection({ eye, [key]: { x: 1, y: 2 } } as PerspectiveProjectionOptions), /needs x, y, and z/)
      assert.throws(() => perspective_projection({ eye, [key]: [1, 2, 3] } as never), /coordinate record/)
      assert.throws(() => perspective_projection({ eye, [key]: { x: 1, y: 2, z: Infinity } }), /finite/)
    }
  },
  'factories snapshot camera options and retain immutable projection identities'() {
    const options = { eye: { ...eye }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 }, focal_length: 2, near: 0.5 }
    const projection = perspective_projection(options), point = { x: 2, y: 0, z: 3 }
    const before = projection.project(point)
    options.eye.y = -100; options.target.x = 100; options.up.x = 100; options.focal_length = 10; options.near = 100
    assert.deepEqual(projection.project(point), before)
    assert.ok(Object.isFrozen(projection) && Object.isFrozen(before))
    assert.ok(!Object.isFrozen(options.eye) && !Object.isFrozen(point))
    const angles = { azimuth: 90, elevation: 0 }, ortho = orthographic_projection(angles)
    angles.azimuth = 0; angles.elevation = 90
    near_point(ortho.project(point), 2, 3)
  },
  '3D factories work in JSX and Graph across sampling, markers, positions, and resize'() {
    const factories = ['isometric_projection()', 'orthographic_projection({azimuth: 90, elevation: 0})',
      'perspective_projection({eye: {x: 0, y: -4, z: 0}})']
    const points: Point3[] = [{ x: 1, y: -5, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 4, z: 1 }]
    for (const factory of factories) {
      const projection: Projection = evaluate(`return ${factory}`)
      const source = evaluate(`
        const points = ${JSON.stringify(points)}
        return <Graph xlim={[-5, 5]} ylim={[-5, 5]} projection={${factory}}>
          <CoordLine points={points} />
          <Points points={points} point-size={({z}) => px(z + 2)} />
          <SymLine f={t => points[t]} tvals={[0, 1, 2]} />
          <Rect pos={points[1]} width={px(4)} height={px(6)} anchor="center" />
          <Rect pos={[px(10), px(20)]} width={px(4)} height={px(6)} />
        </Graph>
      `)
      const projected = points.map(point => projection.project(point))
      const expected = new Graph({ xlim: [-5, 5], ylim: [-5, 5], children: [
        new CoordLine({ points: projected }),
        new Points({ points: projected, point_size: (_, i) => px(points[i].z + 2) }),
        new SymLine({ f: t => projected[t], tvals: [0, 1, 2] }),
        new Rect({ pos: projected[1]!, width: px(4), height: px(6), anchor: 'center' }),
        new Rect({ pos: [px(10), px(20)], width: px(4), height: px(6) }),
      ] })
      const pass = new LayoutPass()
      for (const width of [200, 400]) {
        const request = make_request({ width: exact(width), height: exact(width / 2) })
        const fragment = pass.layout(source, request)
        assert.deepEqual(fragment, pass.layout(expected, request), factory)
        assert.equal(pass.layout(source, request), fragment)
      }
    }
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} 3D projection checks passed.`)

function projection_types() {
  const eye: Point3 = { x: 4, y: 4, z: 3 }
  const projection: Projection = perspective_projection({ eye, target: { x: 0, y: 0, z: 0 } })
  new Graph({ xlim: [-1, 1], ylim: [-1, 1], projection })
  // @ts-expect-error Camera points require all three named coordinates.
  perspective_projection({ eye: { x: 1, y: 2 } })
  // @ts-expect-error Camera positions use records, not three-entry tuples.
  perspective_projection({ eye: [1, 2, 3] })
  // @ts-expect-error Camera coordinates must be numeric.
  perspective_projection({ eye: { x: 1, y: 2, z: px(3) } })
  // @ts-expect-error Angles are numbers in degrees.
  orthographic_projection({ azimuth: '45deg' })
}
