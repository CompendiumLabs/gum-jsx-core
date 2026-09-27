import assert from 'node:assert/strict'
import {
  Projection, Graph, LayoutPass, read_coordinate, copy_coordinate,
  coordinate_point, coordinate_length, map_point, unmap_point, copy_coordinates,
  define_element, shape_size, make_fragment, place_fragment, make_measure,
  make_request, exact, px, em, evaluate,
} from '../src/index'
import type { Coordinate, CoordinateValue, CoordinatePosition, Coordinates, ElementProps, ProjectionFunction } from '../src/index'
import { read_point } from '../src/engine/geometry'

const size = { width: 200, height: 100 }, measure = make_measure({ font_size: 10 })
const cartesian: Coordinates = { xlim: [0, 10], ylim: [0, 10], flip_x: false, flip_y: true }
const polar: ProjectionFunction = ({ theta, r }) => ({ x: r * Math.cos(theta), y: r * Math.sin(theta) })
const frame = (project: ProjectionFunction): Coordinates => ({ ...cartesian, projection: new Projection(project) })

const tests: Record<string, () => void> = {
  'source records retain dimensions while tuple shorthand always names x and y'() {
    const input = { z: 3, x: 1, y: 2 }, output = read_coordinate(input)
    assert.deepEqual(output, input)
    assert.notEqual(output, input)
    assert.ok(Object.isFrozen(output))
    assert.ok(!Object.isFrozen(input))
    input.z = 9
    assert.equal(output.z, 3)
    assert.deepEqual(read_coordinate([1, 2]), { x: 1, y: 2 })
    assert.deepEqual(read_coordinate({ theta: 0, r: 2 }), { theta: 0, r: 2 })
    assert.deepEqual(read_coordinate(Object.assign(Object.create(null), { t: 1 })), { t: 1 })
    // Existing 2D readers retain their own contract.
    assert.throws(() => read_point({ theta: 0, r: 1 } as never), /exactly two coordinates/)
  },
  'representation reading preserves nonfinite samples for later gap handling'() {
    assert.deepEqual(read_coordinate({ x: 1, y: 2, z: NaN }), { x: 1, y: 2, z: NaN })
    assert.deepEqual(read_coordinate([Infinity, 2]), { x: Infinity, y: 2 })
    assert.throws(() => copy_coordinate({ x: 1, y: 2, z: NaN }), /coordinate.z must be finite/)
    assert.throws(() => copy_coordinate({ t: Infinity }), /coordinate.t must be finite/)
  },
  'source readers reject malformed containers and projection copies reject nonnumeric fields'() {
    const inherited = Object.create({ x: 1, y: 2 })
    const malformed = [null, undefined, 3, '1,2', [], [1], [1, 2, 3], Array(2), [1, ,],
      {}, inherited, new Date(), { x: 1, y: 2, [Symbol('z')]: 3 }]
    for (const value of malformed) {
      assert.throws(() => read_coordinate(value as CoordinateValue), /coordinate record or \[x, y\] pair/)
    }
    for (const value of [undefined, null, '3', px(3), { nested: 3 }, [3], () => 3]) {
      assert.throws(() => copy_coordinate({ x: 1, y: 2, z: value } as unknown as Coordinate), /coordinate.z must be a number/)
    }
  },
  'projections snapshot immutable records without freezing caller-owned objects'() {
    const input = { a: 1, b: 2, c: 3 }, result = { u: 4, v: 5, w: 6 }
    let received: Coordinate | undefined
    const projection = new Projection(point => {
      received = point
      assert.ok(Object.isFrozen(point))
      assert.throws(() => { (point as Record<string, number>).a = 99 }, TypeError)
      return result
    })
    const output = projection.project(input)
    assert.deepEqual(received, input)
    assert.notEqual(received, input)
    assert.deepEqual(output, result)
    assert.notEqual(output, result)
    assert.ok(Object.isFrozen(projection))
    assert.ok(Object.isFrozen(output))
    assert.ok(!Object.isFrozen(input))
    assert.ok(!Object.isFrozen(result))
    input.c = 30; result.w = 60
    assert.equal(received!.c, 3)
    assert.equal(output!.w, 6)
  },
  'direct projections require finite records on both sides, including extra dimensions'() {
    let calls = 0
    const identity = new Projection(point => { calls++; return point })
    for (const input of [[1, 2], {}, null, undefined, { x: 1, y: 2, z: Infinity }, { theta: px(2) }]) {
      assert.throws(() => identity.project(input as Coordinate), /coordinate record|finite|number/)
    }
    assert.equal(calls, 0)
    for (const output of [[1, 2], {}, undefined, { x: 1, y: 2, z: NaN }, { x: 1, y: px(2) }]) {
      const invalid = new Projection(() => output as Coordinate)
      assert.throws(() => invalid.project({ t: 0 }), /projection output/)
    }
    assert.deepEqual(identity.project({ t: 1 }), { t: 1 })
    assert.equal(new Projection(() => null).project({ t: 0 }), null)
  },
  'manual composition can change dimension names and count and propagate null'() {
    const expand = new Projection(({ t }) => t < 0 ? null : { a: t, b: t * 2, c: t * 3 })
    const flatten = new Projection(({ a, b, c }) => ({ x: a + c, y: b }))
    const combined = new Projection(point => {
      const intermediate = expand.project(point)
      return intermediate === null ? null : flatten.project(intermediate)
    })
    assert.deepEqual(combined.project({ t: 1 }), { x: 4, y: 2 })
    assert.equal(combined.project({ t: -1 }), null)
    assert.deepEqual(map_point({ t: 1 }, { ...cartesian, projection: combined }, size), { x: 80, y: 80 })
    assert.equal(map_point({ t: -1 }, { ...cartesian, projection: combined }, size), null)
  },
  'mapping preserves named and extra dimensions until the final Cartesian boundary'() {
    assert.deepEqual(map_point({ theta: 0, r: 2 }, frame(polar), size), { x: 40, y: 100 })
    const three = frame(({ x, y, z }) => ({ x: x + z, y: y + z, depth: z }))
    assert.deepEqual(map_point({ x: 1, y: 2, z: 3 }, three, size), { x: 80, y: 50 })
    assert.deepEqual(coordinate_point({ x: 1, y: 2, z: 3 }, size, measure, three), { x: 80, y: 50 })
    assert.deepEqual(coordinate_point({ theta: 0, r: 2 }, size, measure, frame(polar)), { x: 40, y: 100 })
    const renamed = frame(({ x, y }) => ({ u: x, v: y }))
    assert.deepEqual(renamed.projection!.project({ x: 1, y: 2 }), { u: 1, v: 2 })
    assert.throws(() => map_point([1, 2], renamed, size), /Projection output needs x and y/)
    assert.throws(() => map_point({ theta: 0, r: 2 }, cartesian, size), /require a projection/)
    assert.throws(() => map_point({ x: 1, y: 2, z: NaN }, cartesian, size), /coordinate.z must be finite/)
  },
  'tuple expansion precedes projection and viewport limits and flips follow it'() {
    const coord = copy_coordinates({ xlim: [10, 0], ylim: [0, 10], flip_x: true, flip_y: false,
      projection: new Projection(point => {
        assert.deepEqual(point, { x: 1, y: 2 })
        return { x: point.x + point.y, y: point.y }
      }) })
    const projected = map_point([1, 2], coord, size)!
    assert.ok(Math.abs(projected.x - 60) < 1e-8)
    assert.equal(projected.y, 20)
    assert.deepEqual(map_point([1, 2], cartesian, size), { x: 20, y: 80 })
    assert.equal(unmap_point([20, 80], cartesian, size).x, 1)
    assert.throws(() => unmap_point([20, 80], coord, size), /inverse/)
    assert.throws(() => coordinate_length(1, 'x', size, measure, coord), /coordinate record/)
  },
  'local Cartesian lengths bypass projection while mixed and named lengths are rejected'() {
    let calls = 0
    const coord = frame(() => { calls++; return null })
    for (const position of [[px(7), em(2)], { x: '50%', y: '25%' }] as const) {
      const expected = Array.isArray(position) ? { x: 7, y: 20 } : { x: 100, y: 25 }
      assert.deepEqual(coordinate_point(position, size, measure, coord), expected)
    }
    assert.equal(calls, 0)
    assert.deepEqual(coordinate_point([0.5, em(2)], size, measure), { x: 100, y: 20 })
    assert.deepEqual(coordinate_point([1, px(7)], size, measure, cartesian), { x: 20, y: 7 })
    assert.throws(() => coordinate_point([1, px(7)], size, measure, coord), /numeric data coordinates/)
    for (const position of [{ theta: 0, r: em(2) }, { x: px(1), y: px(2), z: 3 }, { theta: 0, r: 2 }]) {
      assert.throws(() => coordinate_point(position as CoordinatePosition, size, measure), /Local positions need exactly x and y/)
    }
    assert.throws(() => coordinate_point({ theta: 0, r: em(2) } as never, size, measure, coord), /numeric components/)
    assert.equal(calls, 0)
    assert.equal(coordinate_point({ t: 1 }, size, measure, coord), null)
    assert.equal(calls, 1)
  },
  'custom elements use named coordinates through Graph and cache separately for each projection'() {
    const Mark = define_element<ElementProps & { point: Coordinate }>('CoordinateMark', (props, query) => {
      const size = shape_size(query.request, query.sizing)
      const point = coordinate_point(props.point, size, query.measure, query.coordinates)
      return make_fragment({ size, children: point
        ? [place_fragment(make_fragment({ size: { width: 1, height: 1 } }), point)] : [] })
    })
    const child = new Mark({ point: { x: 1, y: 2, z: 3 } })
    const projection = new Projection(({ x, y, z }) => ({ x: x + z, y: y + z }))
    const graph = new Graph({ xlim: [0, 10], ylim: [0, 10], projection, children: child })
    const pass = new LayoutPass(), fixed = make_request({ width: exact(200), height: exact(100) })
    const first = pass.layout(graph, fixed)
    assert.deepEqual(first.children[0].fragment.children[0].offset, { x: 80, y: 50 })
    assert.equal(pass.layout(graph, fixed), first)
    const resized = pass.layout(graph, make_request({ width: exact(400), height: exact(200) }))
    assert.deepEqual(resized.children[0].fragment.children[0].offset, { x: 160, y: 100 })
    const other = new Graph({ ...graph.props, projection: ({ x, y, z }) => ({ x: x - z, y: y + z }) })
    assert.deepEqual(pass.layout(other, fixed).children[0].fragment.children[0].offset, { x: -40, y: 50 })
    const hidden = new Graph({ ...graph.props, projection: () => null })
    assert.equal(pass.layout(hidden, fixed).children[0].fragment.children.length, 0)
    const invalid = new Graph({ ...graph.props, projection: () => ({ u: 1, v: 2 }) })
    assert.throws(() => pass.layout(invalid, fixed), /Projection output needs x and y/)
  },
  'evaluated source exposes the coordinate helpers and record projection contract'() {
    assert.deepEqual(evaluate(`
      const point = copy_coordinate(read_coordinate({theta: 0, r: 2}))
      const projection = new Projection(({theta, r}) => ({x: r * cos(theta), y: r * sin(theta)}))
      return projection.project(point)
    `), { x: 2, y: 0 })
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} coordinate checks passed.`)

// Compile-only checks live with the runtime contract and run under strict tsc.
function coordinate_types() {
  const source: CoordinateValue = { theta: 0, r: 1 }
  const position: CoordinatePosition = [px(1), em(2)]
  const projection: ProjectionFunction = ({ theta, r }) => ({ x: theta + r, y: r })
  new Projection(projection).project(read_coordinate(source))
  new Projection(({ theta, r }) => ({ x: theta + r, y: r }))
  new Graph({ xlim: [0, 1], ylim: [0, 1], projection: ({ theta, r }) => ({ x: theta + r, y: r }) })
  coordinate_point(position, size, measure)
  // @ts-expect-error Projection calls take records; source consumers expand tuples.
  new Projection(projection).project([0, 1])
  // @ts-expect-error Projection callbacks return records, not pairs.
  new Projection(({ x, y }) => [x, y])
  // @ts-expect-error Arbitrary named dimensions must contain numbers.
  const named_lengths: CoordinatePosition = { theta: 1, r: em(2) }
  // @ts-expect-error Cartesian length positions require both components.
  const partial_lengths: CoordinatePosition = { x: px(1) }
  // @ts-expect-error Projection inputs are immutable.
  new Projection(point => { point.x = 1; return point })
}
