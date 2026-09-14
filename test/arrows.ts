import assert from 'node:assert/strict'
import {
  Arrow, Field, Graph, LayoutPass, data_bounds, em, exact, make_request, px, render_svg,
} from '../src/index'
import type { ArrowProps, LineCap, PathCommand, PathDraw, Point, PositionValue } from '../src/index'

const fixed = make_request({ width: exact(200), height: exact(100) })
const caps: readonly LineCap[] = ['butt', 'round', 'square']
const local = (x: number, y: number): PositionValue => [px(x), px(y)]
function near(a: number, b: number) { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }
function point(command: PathCommand): Point {
  assert.notEqual(command.kind, 'Z')
  return command as Point
}
function paths(props: ArrowProps): readonly PathDraw[] {
  return new LayoutPass().layout(new Arrow(props), fixed).draw as readonly PathDraw[]
}
function inside(p: Point, triangle: readonly Point[]): boolean {
  const sides = triangle.map((a, i) => {
    const b = triangle[(i + 1) % 3]
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  })
  return sides.every(side => side >= -1e-8) || sides.every(side => side <= 1e-8)
}

const tests: Record<string, () => void> = {
  'arrow caps fit inside triangular heads in every direction without moving the tips'() {
    for (const stroke_linecap of caps) for (const [dx, dy] of [[1, 0], [0, 1], [3, 4], [-4, -3]]) {
      const norm = Math.hypot(dx, dy), ux = dx / norm, uy = dy / norm
      const a = { x: 100 - ux * 50, y: 50 - uy * 50 }, b = { x: 100 + ux * 50, y: 50 + uy * 50 }
      const [shaft, head] = paths({ from: local(a.x, a.y), to: local(b.x, b.y),
        head_size: px(32), head_width: 0.65, stroke_width: px(8), stroke_linecap,
        stroke: 'red', head_style: { fill: 'blue' } })
      assert.deepEqual(point(shaft.commands[0]), { kind: 'M', ...a })
      assert.deepEqual(point(head.commands[1]), { kind: 'L', ...b })
      assert.equal(shaft.stroke_linecap, stroke_linecap)
      const end = point(shaft.commands.at(-1)!), radius = shaft.stroke_width / 2
      const triangle = head.commands.slice(0, 3).map(point)
      const cap_points = stroke_linecap === 'round'
        ? Array.from({ length: 64 }, (_, i) => {
          const angle = i / 64 * 2 * Math.PI
          return { x: end.x + radius * Math.cos(angle), y: end.y + radius * Math.sin(angle) }
        }) : [0, stroke_linecap === 'square' ? radius : 0].flatMap(along => [-radius, radius].map(across => ({
          x: end.x + ux * along - uy * across, y: end.y + uy * along + ux * across,
        })))
      // Test the painted cap against the actual head polygon, independently of
      // the inset formula. A half-stroke retreat fails this for all three caps.
      assert.ok(cap_points.every(p => inside(p, triangle)), stroke_linecap)
      assert.ok((b.x - end.x) * ux + (b.y - end.y) * uy > 0)
    }
  },

  'only headed ends retreat and head size zero leaves an ordinary shaft'() {
    const props = { from: local(20, 50), to: local(180, 50), stroke_width: px(6),
      stroke_linecap: 'square' as const, head_width: 1, head_size: px(20) }
    for (const start_head of [false, true]) for (const end_head of [false, true]) {
      const draw = paths({ ...props, start_head, end_head }), shaft = draw[0]
      near(point(shaft.commands[0]).x, start_head ? 29 : 20)
      near(point(shaft.commands.at(-1)!).x, end_head ? 171 : 180)
      assert.equal(draw.length, 1 + Number(start_head) + Number(end_head))
      const tips = draw.slice(1).map(head => point(head.commands[1]).x)
      assert.deepEqual(tips, [...(start_head ? [20] : []), ...(end_head ? [180] : [])])
    }
    const plain = paths({ ...props, start_head: true, end_head: true, head_size: px(0) })
    assert.equal(plain.length, 1)
    assert.deepEqual(plain[0].commands, [{ kind: 'M', x: 20, y: 50 }, { kind: 'L', x: 180, y: 50 }])
  },

  'clearance uses the shaft stroke and remains connected when the head is undersized'() {
    for (const stroke_linecap of caps) {
      const props = { from: local(0, 50), to: local(100, 50), stroke_width: px(6), stroke_linecap,
        head_size: px(20), head_width: 1 }
      const a = paths(props), b = paths({ ...props, head_style: { stroke_width: px(40), stroke: 'blue' } })
      assert.deepEqual(a[0], b[0])
      const end = point(a[0].commands.at(-1)!)
      const expected = stroke_linecap === 'butt' ? 6 : stroke_linecap === 'round' ? Math.hypot(3, 6) : 9
      near(100 - end.x, expected)
      const [short] = paths({ ...props, head_size: px(2) })
      const extension = stroke_linecap === 'butt' ? 0 : 3
      // The front of the cap meets the head's base, even when it cannot fit
      // inside the head. Retreating farther would visibly disconnect the two.
      near(point(short.commands.at(-1)!).x + extension, 98)
      assert.doesNotThrow(() => paths({ ...props, head_width: 0 }))
    }
  },

  'shaft clearance resolves after data mapping with pixel, em, and fractional strokes'() {
    const requests = [fixed, make_request({ width: exact(400), height: exact(160) })]
    for (const stroke_width of [px(6), em(0.5), 0.06]) {
      const arrow = new Arrow({ from: [2, 1], to: [8, 3], start_head: true,
        stroke_width, head_width: 1, head_size: px(24), stroke_linecap: 'round' })
      assert.deepEqual(data_bounds(arrow), { xlim: [2, 8], ylim: [1, 3] })
      const graph = new Graph({ xlim: [10, 0], ylim: [0, 4], flip_y: true,
        font_size: px(12), children: arrow })
      const snapshot = JSON.stringify(graph), pass = new LayoutPass()
      for (const request of requests) {
        const result = pass.layout(graph, request)
        const [shaft, start, end] = result.children[0].fragment.draw as readonly PathDraw[]
        const w = result.size.width, h = result.size.height
        assert.deepEqual(point(start.commands[1]), { kind: 'L', x: w * 0.8, y: h * 0.75 })
        assert.deepEqual(point(end.commands[1]), { kind: 'L', x: w * 0.2, y: h * 0.25 })
        const a = point(shaft.commands[0]), b = point(shaft.commands.at(-1)!), tip = point(end.commands[1])
        const stroke = typeof stroke_width === 'number' ? Math.min(w, h) * stroke_width : 6
        near(Math.hypot(b.x - tip.x, b.y - tip.y), Math.hypot(stroke / 2, stroke))
        near(Math.hypot(a.x - w * 0.8, a.y - h * 0.75), Math.hypot(stroke / 2, stroke))
      }
      assert.equal(JSON.stringify(graph), snapshot)
    }
  },

  'curved and rounded shafts retreat along endpoint directions and retain head positions'() {
    const coordinates = [[20, 90], [20, 90], [80, 20], [140, 80], [190, 30], [190, 30]] as const
    const points = coordinates.map(([x, y]) => local(x, y))
    for (const route of [{ curve: true }, { curve: true, tension: 0 }, { radius: px(12) }, {}]) {
      const arrow = new Arrow({ points, ...route, start_head: true, head_width: 1,
        stroke_width: px(6), head_size: px(24), stroke_linecap: 'round' })
      const before = JSON.stringify(arrow), pass = new LayoutPass()
      const [shaft, start, end] = pass.layout(arrow, fixed).draw as readonly PathDraw[]
      const a = point(shaft.commands[0]), b = point(shaft.commands.at(-1)!)
      assert.deepEqual(point(start.commands[1]), { kind: 'L', x: 20, y: 90 })
      assert.deepEqual(point(end.commands[1]), { kind: 'L', x: 190, y: 30 })
      near((a.x - 20) * -70 - (a.y - 90) * 60, 0)
      near((b.x - 190) * 50 - (b.y - 30) * -50, 0)
      near(Math.hypot(a.x - 20, a.y - 90), Math.hypot(3, 6))
      near(Math.hypot(b.x - 190, b.y - 30), Math.hypot(3, 6))
      assert.ok(shaft.commands.some(c => c.kind === (route.curve ? 'C' : route.radius ? 'Q' : 'L')))
      pass.layout(arrow, make_request({ width: exact(400), height: exact(200) }))
      assert.equal(JSON.stringify(arrow), before)
    }
  },

  'short routes and repeated vertices never reverse the shaft or leave a capped dot'() {
    const props = { start_head: true, head_size: px(20), head_width: 1,
      stroke_width: px(6), stroke_linecap: 'round' as const }
    for (const curve of [false, true]) {
      const [shaft, start, end] = paths({ ...props, from: local(20, 50), to: local(24, 50), curve })
      assert.deepEqual(shaft.commands, [])
      assert.equal(point(start.commands[1]).x, 20); assert.equal(point(end.commands[1]).x, 24)
    }
    const [shaft] = paths({ ...props, stroke_linecap: 'butt',
      points: [local(0, 50), local(0, 50), local(1, 50), local(2, 50), local(98, 50), local(100, 50)] })
    assert.deepEqual(shaft.commands, [{ kind: 'M', x: 6, y: 50 }, { kind: 'L', x: 94, y: 50 }])
    for (const points of [[], [local(10, 10)], [local(10, 10), local(10, 10)]]) {
      const fragment = new LayoutPass().layout(new Arrow({ ...props, points }), fixed)
      assert.equal(fragment.draw.length, 1)
      assert.doesNotMatch(render_svg(fragment), /NaN|Infinity/)
    }
  },

  'field arrows use the same shaft clearance as standalone arrows'() {
    const props = { stroke_width: px(6), head_size: px(20), head_width: 1, stroke_linecap: 'square' as const }
    const field = new Field({ ...props, vectors: [{ point: [1, 1], vector: [2, 1] }] })
    const arrow = new Arrow({ ...props, from: [1, 1], to: [3, 2] })
    const pass = new LayoutPass(), graph = { xlim: [0, 4] as const, ylim: [0, 3] as const }
    const a = pass.layout(new Graph({ ...graph, children: field }), fixed).children[0].fragment
    const b = pass.layout(new Graph({ ...graph, children: arrow }), fixed).children[0].fragment
    assert.deepEqual(a.draw, b.draw)
    const [shaft, head] = a.draw as readonly PathDraw[]
    const end = point(shaft.commands.at(-1)!), tip = point(head.commands[1])
    near(Math.hypot(tip.x - end.x, tip.y - end.y), 9)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} arrow checks passed.`)
