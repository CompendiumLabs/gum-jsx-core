import assert from 'node:assert/strict'
import {
  Arrow, ArrowHead, LayoutPass, arrow_barb, em, exact, make_request, px, render_svg,
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
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} arrow checks passed.`)
