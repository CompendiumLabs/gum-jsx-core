import assert from 'node:assert/strict'
import {
  sample_points, sample_curve, linspace, SymLine, SymFill, SymField, Field, Graph,
  LayoutPass, render_svg, make_request, exact, px,
} from '../src/index'
import type { PathDraw } from '../src/index'

const tests: Record<string, () => void> = {
  'the shared sampler resolves scalar, parametric, and explicit-array inputs'() {
    assert.deepEqual(sample_points({ fy: x => x * x, xlim: [0, 2], samples: 3 }),
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 4 }])
    assert.deepEqual(sample_points({ fx: y => -y, yvals: [2, 4] }), [{ x: -2, y: 2 }, { x: -4, y: 4 }])
    assert.deepEqual(sample_points({ f: t => [t, -t], tlim: [2, 0], samples: 3 }),
      [{ x: 2, y: -2 }, { x: 1, y: -1 }, { x: 0, y: -0 }])
    assert.deepEqual(sample_points({ fx: 2, fy: t => t, tvals: [3, 6] }), [{ x: 2, y: 3 }, { x: 2, y: 6 }])
    assert.deepEqual(sample_points({ xvals: [2, 3], yvals: [5, 7] }), [{ x: 2, y: 5 }, { x: 3, y: 7 }])
    assert.deepEqual(sample_points({ yvals: [5, 7], xlim: [10, 20] }), [{ x: 10, y: 5 }, { x: 20, y: 7 }])
    assert.deepEqual(sample_points(), [])
    assert.deepEqual(sample_points({ fy: 2, samples: 0 }), [])
    assert.deepEqual(linspace(3, 9, 1), [3])
    assert.ok(Object.isFrozen(sample_curve({ fy: 1 })[0].point))
  },

  'nonfinite and null samples retain path breaks and never reach drawing geometry'() {
    const points = sample_points({ fy: x => x === 0 ? Infinity : 1 / x, xvals: [-2, -1, 0, 1, 2] })
    assert.equal(points[2], null)
    const line = new SymLine({ fy: x => x === 0 ? NaN : 1 / x, xvals: [-2, -1, 0, 1, 2] })
    const root = new LayoutPass().layout(new Graph({ children: line }))
    const path = root.children[0].fragment.draw[0] as PathDraw
    assert.equal(path.commands.filter(command => command.kind === 'M').length, 2)
    assert.ok(!/NaN|Infinity/.test(render_svg(root)))
    assert.deepEqual(sample_points({ f: () => null, samples: 2 }), [null, null])
    const empty = new Graph({ children: new SymLine({ fy: () => Infinity }) })
    assert.equal(new LayoutPass().layout(empty).ink, null)
  },

  'sampling validates sizes and propagates callback failures with the sample index'() {
    assert.throws(() => sample_points({ xvals: [0, 1], yvals: [0] }), /matching lengths/)
    assert.throws(() => sample_points({ fy: 1, samples: -1 }), /samples/)
    assert.throws(() => sample_points({ fy: 1, samples: 2.5 }), /samples/)
    assert.throws(() => sample_points({ f: t => [t, t], fx: 2 }), /either parametric/)
    assert.throws(() => sample_points({ fy: x => { if (x === 1) throw new Error('boom'); return x; },
      xvals: [0, 1] }), /Sample 1/)
  },

  'sampled fills split both boundaries together and include baseline bounds'() {
    const fill = new SymFill({ xvals: [0, 1, 2, 3, 4], upper: x => x === 2 ? NaN : 3, lower: -1 })
    const graph = new LayoutPass().layout(new Graph({ children: fill }))
    const path = graph.children[0].fragment.draw[0] as PathDraw
    assert.equal(path.commands.filter(command => command.kind === 'Z').length, 2)
    assert.equal(path.commands.filter(command => command.kind === 'M').length, 2)
    assert.ok(!/NaN|Infinity/.test(render_svg(graph)))
  },

  'sampled fields skip zero vectors and preserve callback counts across resizing'() {
    let calls = 0
    const field = new SymField({ xlim: [-1, 1], ylim: [-1, 1], samples: 3, scale: 0.2,
      f: (x, y) => { calls++; return [-y, x]; }, head_size: px(5) })
    assert.equal(calls, 9)
    const graph = new Graph({ children: field }), pass = new LayoutPass()
    const before = JSON.stringify(graph)
    const first = pass.layout(graph), second = pass.layout(graph, make_request({ width: exact(800), height: exact(200) }))
    assert.equal(first.children[0].fragment.draw.length, 16)
    assert.equal(second.children[0].fragment.draw.length, 16)
    assert.equal(calls, 9)
    assert.equal(JSON.stringify(graph), before)
    assert.equal(new LayoutPass().layout(new Field({ vectors: [{ point: { x: 0, y: 0 }, vector: { x: 0, y: 0 } }] })).ink, null)
    assert.throws(() => new SymField({ samples: { x: 1000, y: 1000 } }), /samples/)
  },
}
for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} sampling checks passed.`)
