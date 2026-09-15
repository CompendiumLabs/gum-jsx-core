import assert from 'node:assert/strict'
import {
  Arrow, ArrowHead, Field, Graph, LayoutPass, arrow_barb, data_bounds, em, exact, make_request, px, render_svg,
} from '../src/index'
import type { ArrowBarbSide, ArrowProps, LineCap, PathCommand, PathDraw, Point, PositionValue } from '../src/index'

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

function outline(commands: readonly PathCommand[]): Point[] {
  const points: Point[] = []
  for (const command of commands) {
    if (command.kind === 'Z') continue
    if (command.kind === 'C') {
      const a = points.at(-1)!
      for (let i = 1; i <= 128; i++) {
        const u = i / 128, v = 1 - u
        points.push({ x: v ** 3 * a.x + 3 * v ** 2 * u * command.x1 + 3 * v * u ** 2 * command.x2 + u ** 3 * command.x,
          y: v ** 3 * a.y + 3 * v ** 2 * u * command.y1 + 3 * v * u ** 2 * command.y2 + u ** 3 * command.y })
      }
    } else points.push(point(command))
  }
  return points
}
function inside_outline(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const dx = b.x - a.x, dy = b.y - a.y, cross = dx * (p.y - a.y) - dy * (p.x - a.x)
    const dot = (p.x - a.x) * dx + (p.y - a.y) * dy
    if (Math.abs(cross) < 1e-8 && dot >= -1e-8 && dot <= dx * dx + dy * dy + 1e-8) return true
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (p.y - a.y) * dx / dy) inside = !inside
  }
  return inside
}

const tests: Record<string, () => void> = {
  'single barbs follow the direction of travel and close filled heads along the shaft'() {
    for (const barb of ['left', 'right'] as const) for (const curve of [0, 0.7, 1]) {
      for (const open of [false, true]) for (const angle of [0, 90, 180, 270]) {
        const props = { tip: local(100, 50), head_size: px(40), head_width: 1, barb, curve, open, angle }
        const fragment = new LayoutPass().layout(new ArrowHead(props), fixed)
        const head = fragment.draw[0] as PathDraw
        const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
        const points = outline(head.commands)
        const across = points.map(p => -(p.x - 100) * s + (p.y - 50) * c)
        assert.ok(across.every(value => barb === 'left' ? value <= 1e-8 : value >= -1e-8))
        near(Math.max(...across.map(Math.abs)), 20)
        assert.ok(points.some(p => Math.hypot(p.x - 100, p.y - 50) < 1e-8))
        assert.equal(head.commands.at(-1)!.kind === 'Z', !open)
        assert.equal(head.commands.filter(command => command.kind === 'C').length, curve ? 1 : 0)
        if (!open) {
          const base = point(head.commands.at(-2)!)
          near(base.x, 100 - 40 * c); near(base.y, 50 - 40 * s)
        }
      }
    }
    for (const head_barb of ['left', 'right'] as const) for (const head_open of [false, true]) {
      const style = { stroke: 'blue', fill: 'blue', stroke_width: px(2) }
      const props = { ...style, from: local(20, 50), to: local(180, 50), start_head: true,
        head_barb, head_open, head_curve: 0.7, head_size: px(24), head_width: 1 }
      const [shaft, start, end] = paths({ ...props, head_stroke: 'blue' })
      assert.deepEqual(shaft.commands, [{ kind: 'M', x: 20, y: 50 }, { kind: 'L', x: 180, y: 50 }])
      const pass = new LayoutPass()
      for (const [head, x, angle] of [[start, 20, 180], [end, 180, 0]] as const) {
        assert.deepEqual(head, pass.layout(new ArrowHead({ ...style, tip: local(x, 50), angle,
          barb: head_barb, open: head_open, curve: 0.7, head_size: px(24), head_width: 1 }), fixed).draw[0])
      }
    }
    assert.throws(() => paths({ head_barb: 'up' as ArrowBarbSide }), /barb/)
    assert.throws(() => new LayoutPass().layout(new ArrowHead({ barb: 'up' as ArrowBarbSide }), fixed), /barb/)
  },

  'open Arrow heads match ArrowHead and meet the shaft at both ends'() {
    for (const curve of [0, 0.7, 1]) for (const stroke_linecap of caps) {
      for (const start_head of [false, true]) for (const end_head of [false, true]) {
        const style = { stroke: 'blue', stroke_width: px(4), stroke_linecap,
          stroke_linejoin: 'round' as const, opacity: 0.6 }
        const [shaft, ...heads] = paths({ ...style, from: local(20, 50), to: local(180, 50),
          start_head, end_head, head_open: true, head_curve: curve, head_size: px(24), head_width: 1.3 })
        assert.deepEqual(shaft.commands, [{ kind: 'M', x: 20, y: 50 }, { kind: 'L', x: 180, y: 50 }])
        const expected = [
          ...(start_head ? [{ tip: local(20, 50), angle: 180 }] : []),
          ...(end_head ? [{ tip: local(180, 50), angle: 0 }] : []),
        ].map(position => new LayoutPass().layout(new ArrowHead({ ...style, ...position,
          open: true, curve, head_size: px(24), head_width: 1.3 }), fixed).draw[0])
        assert.deepEqual(heads, expected)
        assert.ok(heads.every(head => head.fill === 'none' && head.stroke === 'blue'
          && head.commands.at(-1)!.kind !== 'Z'))
      }
    }
    for (const route of [{ curve: true }, { radius: px(12) }, {}]) {
      const points = [local(20, 80), local(90, 20), local(180, 70)]
      const [shaft] = paths({ points, ...route, start_head: true, head_open: true, head_curve: 0.7 })
      assert.deepEqual(point(shaft.commands[0]), { kind: 'M', x: 20, y: 80 })
      near(point(shaft.commands.at(-1)!).x, 180); near(point(shaft.commands.at(-1)!).y, 70)
    }
    const [short, ...heads] = paths({ from: local(20, 50), to: local(22, 50), start_head: true, head_open: true })
    assert.equal(short.commands.length, 2); assert.equal(heads.length, 2)
    assert.equal(paths({ head_open: true, head_size: px(0) }).length, 1)
    assert.equal(paths({ from: local(20, 50), to: local(20, 50), head_open: true }).length, 1)
  },

  'head options share paint and length resolution without changing shaft styles'() {
    const props: ArrowProps = { from: local(20, 50), to: local(180, 50), font_size: px(10),
      stroke: 'red', stroke_width: px(5), stroke_linecap: 'square',
      head_size: em(1), head_width: 1, head_font_size: em(2), head_open: true, head_curve: 0.7,
      head_stroke: 'blue', head_stroke_width: em(0.1), head_stroke_linecap: 'butt',
      head_stroke_linejoin: 'round', head_stroke_dasharray: [em(0.2), em(0.1)], head_opacity: 0.5, head_fill: 'green' }
    const [shaft, head] = paths(props)
    assert.equal(shaft.stroke, 'red'); assert.equal(shaft.stroke_width, 5); assert.equal(shaft.stroke_linecap, 'square')
    const standalone = new LayoutPass().layout(new ArrowHead({ tip: local(180, 50), font_size: px(20),
      head_size: em(1), head_width: 1, open: true, curve: 0.7, stroke: 'blue', stroke_width: em(0.1),
      stroke_linecap: 'butt', stroke_linejoin: 'round', stroke_dasharray: [em(0.2), em(0.1)], opacity: 0.5 }), fixed)
    assert.deepEqual(head, standalone.draw[0])
    assert.equal(head.stroke_width, 2)
    near(point(head.commands[0]).x, 160)
    const [, hidden] = paths({ ...props, head_stroke: 'none' })
    assert.equal(hidden.stroke, 'none'); assert.equal(hidden.fill, 'none')
    const [, closed] = paths({ ...props, head_open: false })
    assert.equal(closed.fill, 'green'); assert.equal(closed.commands.at(-1)!.kind, 'Z')
  },

  'arrowhead curvature preserves endpoints and bows open and filled barbs toward the shaft'() {
    for (const curve of [0, 1e-12, 0.35, 0.7, 1]) for (const open of [false, true]) {
      const props = { tip: local(100, 50), head_size: px(40), head_width: 1, stroke: 'blue', curve, open }
      const pass = new LayoutPass(), element = new ArrowHead(props)
      const [head] = pass.layout(element, fixed).draw as readonly PathDraw[]
      const [upper, tip, lower] = head.commands
      assert.deepEqual(point(upper), { kind: 'M', x: 60, y: 30 })
      near(point(tip).x, 100); near(point(tip).y, 50)
      near(point(lower).x, 60); near(point(lower).y, 70)
      assert.equal(head.commands.at(-1)!.kind === 'Z', !open)
      assert.equal(head.fill === 'none', open)
      assert.equal(tip.kind, curve ? 'C' : 'L')
      if (curve && tip.kind === 'C') {
        const middle = outline(head.commands)[64]
        assert.ok(middle.y >= 50 - (100 - middle.x) / 2 - 1e-8)
        if (curve === 1) near(tip.y2, 50)
      }
      const rotated = pass.layout(new ArrowHead({ ...props, angle: 90 }), fixed).draw[0] as PathDraw
      const points = outline(head.commands), turned = outline(rotated.commands)
      for (let i = 0; i < points.length; i++) {
        near(turned[i].x, 100 - (points[i].y - 50))
        near(turned[i].y, 50 + (points[i].x - 100))
      }
    }
    const props = { tip: local(100, 50), head_size: px(40) }
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(new ArrowHead(props), fixed).draw,
      pass.layout(new ArrowHead({ ...props, curve: 0 }), fixed).draw)
    const straight = arrow_barb(40, 1)
    assert.deepEqual(straight.at(-1), { x: 0, y: 0 })
    assert.deepEqual(straight.at(2), { x: 40, y: 20 })
    for (const curve of [-0.1, 1.1, NaN, Infinity]) {
      assert.throws(() => pass.layout(new ArrowHead({ curve }), fixed), /curve/)
      assert.throws(() => paths({ head_curve: curve }), /curve/)
    }
    for (const head_width of [0, 3]) for (const head_size of [px(0), px(40)]) {
      const f = pass.layout(new ArrowHead({ ...props, curve: 1, head_width, head_size }), fixed)
      assert.doesNotMatch(render_svg(f), /NaN|Infinity/)
    }
  },

  'curved heads contain thick shaft caps in every direction and keep both tips fixed'() {
    for (const head_curve of [0.35, 0.7, 1]) for (const head_width of [0.65, 1.3, 3]) {
      for (const stroke_linecap of caps) for (const [ux, uy] of [[1, 0], [0, -1], [-0.6, 0.8]]) {
        const a = { x: 100 - ux * 70, y: 50 - uy * 70 }, b = { x: 100 + ux * 70, y: 50 + uy * 70 }
        const [shaft, start, end] = paths({ from: local(a.x, a.y), to: local(b.x, b.y),
          start_head: true, head_size: px(32), head_width, head_curve, stroke_width: px(8), stroke_linecap })
        for (const [head, cap, tip, sign] of [
          [start, point(shaft.commands[0]), a, -1], [end, point(shaft.commands.at(-1)!), b, 1],
        ] as const) {
          const polygon = outline(head.commands)
          assert.ok(polygon.some(p => Math.hypot(p.x - tip.x, p.y - tip.y) < 1e-8))
          const cap_points = stroke_linecap === 'round'
            ? Array.from({ length: 64 }, (_, i) => ({
              x: cap.x + 4 * Math.cos(i * Math.PI / 32), y: cap.y + 4 * Math.sin(i * Math.PI / 32),
            })) : [0, stroke_linecap === 'square' ? 4 : 0].flatMap(along => [-4, 4].map(across => ({
              x: cap.x + sign * ux * along - uy * across, y: cap.y + sign * uy * along + ux * across,
            })))
          assert.ok(cap_points.every(p => inside_outline(p, polygon)), `${head_curve} / ${head_width} / ${stroke_linecap}`)
        }
      }
    }
    for (const curve of [false, true]) {
      const props = { points: [local(20, 80), local(90, 20), local(180, 70)], curve }
      const [shaft, head] = paths({ ...props, head_curve: 0.7 })
      assert.equal(shaft.commands.some(c => c.kind === 'C'), curve)
      assert.ok(head.commands.some(c => c.kind === 'C'))
      const [, straight] = paths({ ...props, head_curve: 0 })
      assert.ok(!straight.commands.some(c => c.kind === 'C'))
    }
  },

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
    const curved_field = new Field({ ...props, head_curve: 0.7, vectors: [{ point: [1, 1], vector: [2, 1] }] })
    const curved_arrow = new Arrow({ ...arrow.props, head_curve: 0.7 })
    assert.deepEqual(pass.layout(new Graph({ ...graph, children: curved_field }), fixed).children[0].fragment.draw,
      pass.layout(new Graph({ ...graph, children: curved_arrow }), fixed).children[0].fragment.draw)
    const head_style = { open: true, curve: 0.7, stroke: 'blue', stroke_width: px(2) }
    const open_field = new Field({ ...props, head_style, vectors: [{ point: [1, 1], vector: [2, 1] }] })
    const open_arrow = new Arrow({ ...arrow.props, head_style })
    assert.deepEqual(pass.layout(new Graph({ ...graph, children: open_field }), fixed).children[0].fragment.draw,
      pass.layout(new Graph({ ...graph, children: open_arrow }), fixed).children[0].fragment.draw)
    const flat_field = new Field({ ...props, head_open: true, head_curve: 0.7, head_stroke: 'blue',
      head_stroke_width: px(2), vectors: [{ point: [1, 1], vector: [2, 1] }] })
    assert.deepEqual(pass.layout(new Graph({ ...graph, children: flat_field }), fixed).children[0].fragment.draw,
      pass.layout(new Graph({ ...graph, children: open_field }), fixed).children[0].fragment.draw)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} arrow checks passed.`)
