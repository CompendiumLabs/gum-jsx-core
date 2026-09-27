import assert from 'node:assert/strict'
import {
  Group, Overlay, Graph, Plot, Network, Node, Rect, LayoutPass, Projection,
  define_element, make_fragment, shape_size, make_request,
  exact, px, em, evaluate, data_bounds,
} from '../src/index'
import type { Element, ElementProps, CoordinatePosition } from '../src/index'

const fixed = make_request({ width: exact(200), height: exact(100) })
const limits = { xlim: [-1, 1], ylim: [-1, 1] } as const
const box = { width: px(20), height: px(10), anchor: 'center' } as const
const layout = (element: Element) => new LayoutPass().layout(element, fixed)

const tests: Record<string, () => void> = {
  'positioned children default to center and unpositioned children retain the origin'() {
    const parents = [
      (child: Element) => new Group({ children: child }),
      (child: Element) => new Overlay({ children: [new Rect(), child] }),
      (child: Element) => new Graph({ ...limits, children: child }),
      (child: Element) => new Plot({ ...limits, children: child }),
      (child: Element) => new Network({ ...limits, children: child }),
    ]
    const size = { width: px(20), height: px(10) }
    const positions: CoordinatePosition[] = [[0.5, 0.5], { x: em(2), y: '50%' }, [0, 0], [px(0), px(0)]]
    for (const parent of parents) {
      for (const pos of positions) {
        assert.deepEqual(layout(parent(new Rect({ ...size, pos }))),
          layout(parent(new Rect({ ...size, pos, anchor: 'center' }))))
      }
      for (const props of [{}, { pos: undefined }]) {
        assert.deepEqual(layout(parent(new Rect({ ...size, ...props }))),
          layout(parent(new Rect({ ...size, ...props, anchor: 'start' }))))
      }
    }
    const offsets = (props: ElementProps) => layout(new Group({ children: new Rect({ ...size, ...props }) }))
      .children[0].offset
    assert.deepEqual(offsets({ pos: [0.5, 0.5] }), { x: 90, y: 45 })
    assert.deepEqual(offsets({ pos: [0.5, 0.5], anchor: 'start' }), { x: 100, y: 50 })
    assert.deepEqual(offsets({ pos: [0.5, 0.5], anchor: 0 }), { x: 100, y: 50 })
    assert.deepEqual(offsets({ pos: [0.5, 0.5], anchor: 'end' }), { x: 80, y: 40 })
    assert.deepEqual(offsets({ pos: [0.5, 0.5], anchor: { y: 'center' } }), { x: 100, y: 45 })
    assert.deepEqual(offsets({ anchor: 'center' }), { x: -10, y: -5 })
  },
  'tuple and record positions resolve local lengths and child fonts in Group and Overlay'() {
    const a = new Rect({ ...box, font_size: px(10), pos: [em(2), '50%'] })
    const b = new Rect({ ...box, font_size: px(10), pos: { x: em(2), y: '50%' } })
    for (const child of [a, b]) {
      const group = layout(new Group({ font_size: px(30), children: child }))
      const overlay = layout(new Overlay({ font_size: px(30), children: [new Rect(), child] }))
      assert.deepEqual(group.children[0].offset, { x: 10, y: 45 })
      assert.deepEqual(overlay.children[1].offset, group.children[0].offset)
      assert.deepEqual(group.children[0].fragment.size, { width: 20, height: 10 })
    }
  },
  'Graph distinguishes omitted positions from data zero and local zero'() {
    const size = { width: px(20), height: px(10) }
    const result = layout(new Graph({ ...limits, children: [
      new Rect(size), new Rect({ ...size, pos: undefined }), new Rect({ ...size, pos: [0, 0] }),
      new Rect({ ...size, pos: { x: 0, y: 0 } }), new Rect({ ...size, pos: [px(0), px(0)] }),
      new Rect({ ...size, pos: [0, px(0)] }),
    ] }))
    assert.deepEqual(result.children.map(child => child.offset), [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 90, y: 45 },
      { x: 90, y: 45 }, { x: -10, y: -5 }, { x: 90, y: -5 },
    ])
  },
  'named annotations project whole positions and hidden annotations are not measured'() {
    let layouts = 0, projections = 0
    const Mark = define_element('PositionMark', (_, query) => {
      layouts++
      return make_fragment({ size: shape_size(query.request, query.sizing) })
    })
    const graph = new Graph({ ...limits, projection: ({ t, depth }) => {
      projections++
      return t < 0 ? null : { x: t + depth, y: t }
    }, children: [
      new Mark({ ...box }), new Mark({ ...box, pos: { t: 0, depth: 0.5 } }),
      new Mark({ ...box, pos: { t: -1, depth: 0 } }),
      new Mark({ ...box, pos: [px(20), px(30)] }),
    ] })
    const result = layout(graph)
    assert.equal(projections, 2)
    assert.equal(layouts, 3)
    assert.deepEqual(result.children[0].offset, { x: -10, y: -5 })
    assert.deepEqual(result.children[1].offset, { x: 140, y: 45 })
    assert.deepEqual(result.children[2].fragment.size, { width: 0, height: 0 })
    assert.deepEqual(result.children[3].offset, { x: 10, y: 25 })
  },
  'projected Node annotations bypass Cartesian bounds discovery when limits are explicit'() {
    const child = new Node({ ...box, pos: { angle: 0, radius: 0.5 }, padding: 0, border_width: 0 })
    const projection = new Projection(({ angle, radius }) => ({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) }))
    for (const coordinates of [limits, { coord: [-1, -1, 1, 1] as const }]) {
      const result = layout(new Graph({ ...coordinates, projection, children: child }))
      assert.deepEqual(result.children[0].offset, { x: 140, y: 45 })
    }
  },
  'Network bounds read pos components and Node retains an explicit default origin'() {
    assert.deepEqual(new Node().props.pos, [0, 0])
    assert.equal(new Node({ pos: undefined }).props.pos, undefined)
    assert.deepEqual(data_bounds(new Node({ pos: [2, 4] })), { xlim: [2, 2], ylim: [4, 4] })
    assert.deepEqual(data_bounds(new Node({ pos: { x: 2, y: px(4) } })), { xlim: [2, 2] })
    const result = layout(new Network({ padding: 0, children: [
      new Rect({ pos: [2, 4], width: px(10), height: px(10) }),
      new Rect({ pos: { x: 8, y: 6 }, width: px(10), height: px(10) }),
    ] }))
    assert.deepEqual(result.children.map(child => child.offset), [{ x: -5, y: 95 }, { x: 195, y: -5 }])
    assert.throws(() => layout(new Network({ children: new Rect({ pos: { theta: 0, r: 1 } }) })), /Cartesian x and y/)
  },
  'pos is an immutable source value and overrides defaults atomically'() {
    const input = { x: 0.25, y: 0.5 }, child = new Rect({ ...box, pos: input })
    input.x = 1
    assert.ok(Object.isFrozen(child.props.pos))
    assert.ok(!Object.isFrozen(input))
    assert.deepEqual(layout(new Group({ children: child })).children[0].offset, { x: 40, y: 45 })
    const Mark = define_element<ElementProps>('PositionDefault', (_, query) =>
      make_fragment({ size: shape_size(query.request, query.sizing) }), { pos: { x: 1, y: 2 } })
    const replaced = new Mark({ pos: { t: 3 } })
    assert.deepEqual(replaced.props.pos, { t: 3 })
    const jsx = evaluate(`
      const defaults = {pos: [0.25, 0.25], width: px(20), height: px(10)}
      return <Group><Rect {...defaults} pos={{x: 0.5, y: 0.75}} /></Group>
    `)
    assert.deepEqual(layout(jsx).children[0].offset, { x: 90, y: 70 })
  },
  'malformed Cartesian positions fail consistently instead of filling missing axes'() {
    for (const pos of [null, [], [1], [1, 2, 3], { x: 1 }, { x: px(1), y: undefined }]) {
      const child = new Rect({ pos: pos as unknown as CoordinatePosition })
      for (const parent of [new Group({ children: child }), new Overlay({ children: [new Rect(), child] }),
        new Graph({ ...limits, children: child })]) {
        assert.throws(() => layout(parent), /coordinate record|exactly x and y|both x and y|need x and y/)
      }
    }
    assert.throws(() => layout(new Graph({ ...limits, projection: point => point,
      children: new Rect({ pos: [1, px(0)] }) })), /numeric data coordinates/)
    assert.throws(() => layout(new Group({ children: new Rect({ pos: { t: 1 } }) })), /require a projection/)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} position checks passed.`)

function position_types() {
  new Rect({ pos: [px(1), em(2)] })
  new Rect({ pos: { theta: 1, r: 2 } })
  // @ts-expect-error Local Cartesian positions require both components.
  new Rect({ pos: { x: px(1) } })
}
