import assert from 'node:assert/strict'
import {
  Network, Node, Edge, Box, Rotate, TransformBox, Text, Circle, Rect, VStack, TitleFrame, LayoutPass,
  define_element, define_component,
  evaluate, make_request, exact, make_fragment, make_size, make_rect, px, em, render_svg,
} from '../src/index'
import * as core from '../src/index'
import type { Element, Fragment, PathDraw, Point, Side } from '../src/index'

const fixed = make_request({ width: exact(600), height: exact(300) })
const limits = { xlim: [0, 1] as const, ylim: [0, 1] as const }
const plain = { curve: false, end_head: false }
function near(a: number, b: number) { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }
function near_point(a: Point, b: Point) { near(a.x, b.x); near(a.y, b.y); }
function shaft(fragment: Fragment) { return (fragment.draw[0] as PathDraw).commands; }
function ends(fragment: Fragment) {
  const commands = shaft(fragment)
  return [commands[0] as Point, commands.at(-1) as Point]
}
function node(id: string, x: number, y: number, props = {}) {
  return new Node({ id, x, y, width: px(80), height: px(40), border_radius: 0, children: id, ...props })
}
function layout(children: readonly Element[], props = {}) {
  return new LayoutPass().layout(new Network({ ...limits, ...props, children }), fixed)
}

const tests: Record<string, () => void> = {
  'nodes hug text and expose the drawn frame separately from their inner content'() {
    const pass = new LayoutPass(), a = pass.layout(new Node({ id: 'a', children: 'A' }))
    const b = pass.layout(new Node({ id: 'b', children: 'A longer label' }))
    assert.ok(a.size.width < b.size.width)
    near(a.size.height, b.size.height)
    assert.deepEqual(a.connection!.boundary, { ...make_rect(0, 0, a.size.width, a.size.height),
      radius: a.children.at(-1)!.fragment.clip!.radius })
    assert.ok(a.content!.x > 0 && a.content!.width < a.connection!.boundary.width)
    assert.equal(pass.layout(new Node({ children: 'Standalone' })).connection, undefined)
    assert.ok(Object.isFrozen(a.connection) && Object.isFrozen(a.connection!.boundary.radius))
  },

  'node alignment positions labels while text_justify controls generated lines'() {
    const pass = new LayoutPass()
    const lines = 'A wider first line\nShort'
    const source = { width: px(200), height: px(80), padding: 0, border_width: 0, children: lines }
    for (const [align, fraction] of [['start', 0], ['center', 0.5], ['end', 1]] as const) {
      const frame = pass.layout(new Node({ ...source, align }))
      const label = frame.children[0]
      const [first, second] = label.fragment.children
      near(label.offset.x, (frame.size.width - label.fragment.size.width) * fraction)
      near(label.offset.y, (frame.size.height - label.fragment.size.height) * fraction)
      near(first.offset.x, 0)
      near(second.offset.x, 0)
    }
    for (const [text_justify, fraction] of [['start', 0], ['center', 0.5], ['end', 1], [0.25, 0.25]] as const) {
      const label = pass.layout(new Node({ ...source, align: 'start', text_justify })).children[0]
      const [first, second] = label.fragment.children
      near(second.offset.x, (first.fragment.size.width - second.fragment.size.width) * fraction)
    }
    const jsx = pass.layout(evaluate('<Node width={px(200)} height={px(80)} padding={0} border-width={0} text-justify="center">A wider first line\nShort</Node>'))
    const text = jsx.children[0].fragment
    near(text.children[1].offset.x, (text.children[0].fragment.size.width - text.children[1].fragment.size.width) / 2)
    const styled = new Node({ children: 'Label', text_font_size: px(24), text_color: 'red', text_wrap: false })
    assert.ok(styled.props.children instanceof Text)
    assert.deepEqual(styled.props.children.props.font_size, px(24))
    assert.equal(styled.props.children.props.color, 'red')
    assert.equal(styled.props.children.props.wrap, false)
    assert.equal('text_font_size' in styled.props, false)
    const explicit = pass.layout(new Node({ ...source, text_justify: 'start',
      children: new Text({ children: lines, justify: 'end' }) }))
    const [wide, short] = explicit.children[0].fragment.children
    near(short.offset.x, wide.fragment.size.width - short.fragment.size.width)
  },

  'edges bind after text reflow and keep source paint order across cached layouts'() {
    const edge = new Edge({ start: 'a', end: 'b', ...plain })
    const a = new Node({ id: 'a', x: 0.2, y: 0.5, children: 'A' })
    const b = new Node({ id: 'b', x: 0.8, y: 0.5, width: 0.2,
      children: 'A label that wraps into several lines' })
    const source = new Network({ ...limits, children: [edge, a, b] })
    const before = JSON.stringify(source), pass = new LayoutPass()
    const wide = pass.layout(source, fixed)
    const narrow = pass.layout(source, make_request({ width: exact(300), height: exact(300) }))
    assert.ok(narrow.children[2].fragment.size.height > wide.children[2].fragment.size.height)
    for (const result of [wide, narrow]) {
      const [edge, a, b] = result.children, [start, end] = ends(edge.fragment)
      near_point(start, { x: a.offset.x + a.fragment.size.width, y: 150 })
      near_point(end, { x: b.offset.x, y: 150 })
      assert.deepEqual(result.children.map(p => p.fragment.name), ['Edge', 'Node', 'Node'])
    }
    assert.equal(pass.layout(source, fixed), wide)
    assert.equal(JSON.stringify(source), before)
    const reordered = pass.layout(new Network({ ...limits, children: [a, b, edge] }), fixed)
    assert.deepEqual(reordered.children[2].fragment.draw, wide.children[0].fragment.draw)
  },

  'connections follow fitted and padded node frames instead of wrapper allocations'() {
    const a = new Node({ id: 'a', width: px(60), height: px(30), border_radius: 0, children: 'A' })
    const wrappers: readonly [Element, Point][] = [
      [new Box({ fit: 'contain', x: 0.3, y: 0.5, anchor: 'center', max_width: px(180), max_height: px(100), children: a }),
        { x: 135, y: 195 }],
      [new Box({ x: 0.3, y: 0.5, anchor: 'center', width: px(180), height: px(100),
        padding: px(10), align: 'center', children: a }), { x: 165, y: 165 }],
    ]
    for (const [wrapper, expected] of wrappers) {
      const result = layout([new Edge({ start: 'a', end: 'b', start_side: 'bottom', start_loc: 0.25,
        end_side: 'left', end_loc: 0.75, ...plain }), wrapper,
      node('b', 0.85, 0.8, { width: px(70), height: px(30) })])
      const [start, end] = ends(result.children[0].fragment)
      near_point(start, expected)
      near_point(end, { x: 475, y: 67.5 })
    }
  },

  'rotated and sheared connections transform the boundary and its outward normals'() {
    const a = node('a', 0, 0)
    const wrappers: readonly [Element, Point, Point][] = [
      [new Rotate({ x: 0.3, y: 0.5, anchor: 'center', angle: 90, children: a }),
        { x: 180, y: 190 }, { x: 0, y: 1 }],
      [new TransformBox({ x: 0.3, y: 0.5, anchor: 'center', matrix: [1, 0.5, 0.2, 1, 10, -5],
        resize: false, children: a }), { x: 234, y: 185 }, { x: 1, y: -0.2 }],
    ]
    for (const [wrapper, expected, normal] of wrappers) {
      const result = layout([new Edge({ start: 'a', end: 'b', start_side: 'right', end_head: false }),
        wrapper, node('b', 0.8, 0.7)])
      const commands = shaft(result.children[0].fragment), control = commands[1]
      near_point(commands[0] as Point, expected)
      assert.equal(control.kind, 'C')
      if (control.kind !== 'C') throw new Error('Expected cubic')
      const dx = control.x1 - expected.x, dy = control.y1 - expected.y
      near(dx * normal.y - dy * normal.x, 0)
      assert.ok(dx * normal.x + dy * normal.y > 0)
    }
  },

  'rounded corner locations meet the visible ellipse and gaps follow its normal'() {
    const a = node('a', 0.25, 0.5, { width: px(100), height: px(60), border_radius: [px(30), px(20)] })
    const local_y = 20 - 20 * Math.sqrt(1 - 4 / 9)
    const nx = -20 / 900, ny = (local_y - 20) / 400, norm = Math.hypot(nx, ny)
    for (const gap of [0, 7]) {
      const result = layout([new Edge({ start: 'a', end: 'b', start_side: 'top', start_loc: 0.1,
        gap: px(gap), ...plain }), a, node('b', 0.8, 0.8)])
      near_point(ends(result.children[0].fragment)[0],
        { x: 110 + gap * nx / norm, y: 120 + local_y + gap * ny / norm })
    }
  },

  'custom node boundaries can be smaller and offset within an allocation'() {
    const Custom = define_element('CustomNode', (_props, query) => make_fragment({
      size: make_size(180, 100), connection: { id: 'custom', boundary: make_rect(30, 20, 40, 20) },
    }))
    const result = layout([new Edge({ start: 'custom', end: 'b', start_side: 'right', ...plain }),
      new Custom({ x: px(40), y: px(60) }), node('b', 0.8, 0.5)])
    near_point(ends(result.children[0].fragment)[0], { x: 110, y: 90 })
  },

  'any identified element is a node and framed shapes supply their visible outline'() {
    const circle = new Circle({ id: 'c', x: 0.25, y: 0.5, anchor: 'center', width: px(80), height: px(80) })
    const rect = new Rect({ id: 'r', x: 0.75, y: 0.5, anchor: 'center', width: px(100), height: px(60),
      border_radius: [px(30), px(20)] })
    const result = layout([new Edge({ start: circle, end: rect, start_side: 'top', start_loc: 0.25,
      end_side: 'top', end_loc: 0.1, ...plain }), circle, rect])
    const [start, end] = ends(result.children[0].fragment)
    // A quarter along the top of a circle lies on the arc, not the bounding square.
    near_point(start, { x: 130, y: 150 - 40 * Math.sqrt(0.75) })
    near_point(end, { x: 410, y: 120 + 20 - 20 * Math.sqrt(1 - 4 / 9) })
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(circle).connection, { id: 'c',
      boundary: { ...make_rect(0, 0, 80, 80), radius: { x: 40, y: 40 } } })
    assert.equal(pass.layout(new Circle({ width: px(80) })).connection, undefined)

    // Elements without a frame of their own connect at their allocation.
    const label = new Text({ id: 't', children: 'Plain text', x: 0.5, y: 0.2, anchor: 'center' })
    const text = layout([new Edge({ start: 't', end: 'r', start_side: 'bottom', ...plain }), label, rect])
    const placed = text.children[1]
    assert.deepEqual(placed.fragment.connection!.boundary,
      make_rect(0, 0, placed.fragment.size.width, placed.fragment.size.height))
    near_point(ends(text.children[0].fragment)[0],
      { x: 300, y: placed.offset.y + placed.fragment.size.height })
  },

  'identified containers stay transparent while nested networks are single nodes'() {
    const group = new VStack({ id: 'group', x: 0.25, y: 0.5, anchor: 'center', width: px(100), gap: px(20),
      children: [new Rect({ id: 'top', height: px(40) }), new Rect({ id: 'bottom', height: px(40) })] })
    const inner = new Network({ ...limits, id: 'inner', x: 0.75, y: 0.5, anchor: 'center',
      width: px(120), height: px(80), children: node('hidden', 0.5, 0.5) })
    const result = layout([new Edge({ start: 'group', end: 'inner', ...plain }),
      new Edge({ start: 'bottom', end: 'inner', start_side: 'right', end_side: 'bottom', ...plain }),
      group, inner])
    const [whole, member] = result.children.slice(0, 2).map(child => ends(child.fragment))
    near_point(whole[0], { x: 200, y: 150 }); near_point(whole[1], { x: 390, y: 150 })
    near_point(member[0], { x: 200, y: 180 }); near_point(member[1], { x: 450, y: 190 })
    assert.throws(() => layout([new Edge({ start: 'group', end: 'hidden' }), group, inner]),
      /Unknown node id: hidden/)
    assert.throws(() => layout([group, new Rect({ id: 'top' })]), /Duplicate node id: top/)
  },

  'compound elements publish one connection however they compose their parts'() {
    const titled = new TitleFrame({ id: 'titled', title: 'Title', x: 0.3, y: 0.5, anchor: 'center',
      width: px(160), border_radius: px(12), children: 'Body' })
    const result = layout([new Edge({ start: 'titled', end: 'b', start_side: 'top', ...plain }),
      new Edge({ start: 'titled', end: 'b', start_side: 'right', ...plain }), titled, node('b', 0.85, 0.5)])
    const placed = result.children[2], { width, height } = placed.fragment.size
    // The outline spans the overhanging title, with only the body's lower corners rounded.
    const zero = { x: 0, y: 0 }, round = { x: 12, y: 12 }
    assert.deepEqual(placed.fragment.connection, { id: 'titled',
      boundary: { ...make_rect(0, 0, width, height), radius: { tl: zero, tr: zero, br: round, bl: round } } })
    assert.ok(placed.fragment.children.every(child => child.fragment.connection === undefined))
    near_point(ends(result.children[0].fragment)[0], { x: 180, y: placed.offset.y })
    near_point(ends(result.children[1].fragment)[0], { x: 180 + width / 2, y: 150 })

    // No element class may forward its id into a part that is also laid out.
    const variants = [{}, { title: 'Title' }, { children: 'Body' }, { caption: 'Caption' },
      { title: 'Title', children: new Text({ children: 'Child' }) }]
    let connected = 0
    for (const [name, value] of Object.entries(core)) {
      if (typeof value !== 'function' || !(value.prototype instanceof core.Element)) continue
      if (name === 'Network' || name === 'Edge') continue
      const Type = value as new (props: object) => Element
      for (const extra of variants) {
        let element: Element
        try { element = new Type({ id: 'n', x: 0.5, y: 0.5, width: px(120), height: px(80), ...extra }) }
        catch { continue }
        try { layout([new Edge({ start: 'n', end: 'b' }), element, node('b', 0.9, 0.9)]); connected++ }
        catch (error) { assert.doesNotMatch(String(error), /Duplicate node id/, name) }
      }
    }
    assert.ok(connected > 100)
  },

  'curved arrows keep both head tips and tangents on the selected ports'() {
    for (const props of [{}, { flip_x: true }, { xlim: [1, 0] as const }, { flip_y: false }]) {
      const result = layout([new Edge({ start: 'a', end: 'b', start_side: 'top', end_side: 'left',
        start_head: true, head_open: true, head_stroke: 'red', stroke: 'blue' }),
      node('a', 0.25, 0.3), node('b', 0.75, 0.7)], props)
      const [edge, a, b] = result.children, commands = shaft(edge.fragment)
      const start = { x: a.offset.x + 40, y: a.offset.y }
      const end = { x: b.offset.x, y: b.offset.y + 20 }
      near_point(commands[0] as Point, start)
      near_point(commands.at(-1) as Point, end)
      const curve = commands[1]
      if (curve.kind !== 'C') throw new Error('Expected cubic')
      near(curve.x1, start.x); assert.ok(curve.y1 < start.y)
      near(curve.y2, end.y); assert.ok(curve.x2 < end.x)
      const [shaft_draw, start_head, end_head] = edge.fragment.draw as readonly PathDraw[]
      assert.equal(shaft_draw.stroke, 'blue')
      assert.equal(start_head.stroke, 'red')
      near_point(start_head.commands[1] as Point, start)
      near_point(end_head.commands[1] as Point, end)
    }
  },

  'waypoints use graph data or local lengths while endpoint geometry stays in pixels'() {
    for (const space of ['data', 'local'] as const) {
      const result = layout([new Edge({ start: 'a', end: 'b', ...plain, space,
        points: [[0.5, 0.7], [px(330), em(2)]] }), node('a', 0.2, 0.5), node('b', 0.8, 0.5)])
      const commands = shaft(result.children[0].fragment)
      near_point(commands[1] as Point, { x: 300, y: space === 'data' ? 90 : 210 })
      near_point(commands[2] as Point, { x: 330, y: 32 })
    }
    const rounded = layout([new Edge({ start: 'a', end: 'b', radius: px(12) }),
      node('a', 0.2, 0.3), node('b', 0.8, 0.8)])
    assert.ok(shaft(rounded.children[0].fragment).some(c => c.kind === 'Q'))
  },

  'self loops leave and return to the same frame with finite curves and heads'() {
    for (const props of [{}, { curve: false }, { radius: px(10) }, { head_size: px(100), stroke_width: px(20) }]) {
      const result = layout([new Edge({ start: 'a', end: 'a', ...props }), node('a', 0.5, 0.5)])
      const edge = result.children[0].fragment
      near_point(ends(edge)[0], { x: 340, y: 150 })
      near_point((edge.draw[1] as PathDraw).commands[1] as Point, { x: 300, y: 130 })
      assert.ok(shaft(edge).length > 2)
      assert.doesNotMatch(render_svg(result), /NaN|Infinity/)
    }
  },

  'nested networks keep ids local and ordinary annotations keep graph placement'() {
    const inner = new Network({ ...limits, width: px(100), height: px(80), x: 0.5, y: 0.2,
      children: [new Edge({ start: 'a', end: 'a' }), node('a', 0.5, 0.5)] })
    const result = layout([new Edge({ start: 'a', end: 'b', ...plain }), node('a', 0.2, 0.5),
      node('b', 0.8, 0.5), inner, new Text({ children: 'Annotation', x: 0.5, y: 0.8 })])
    near_point(result.children[4].offset, { x: 300, y: 60 })
    assert.throws(() => layout([new Edge({ start: 'a', end: 'inner' }), node('a', 0.2, 0.5),
      new Network({ children: node('inner', 0, 0) })]), /Unknown node id: inner/)
    const clipped = layout([node('a', -0.2, 0.5)], { clip: true })
    assert.ok(clipped.overflow.left > 0)
    assert.equal(clipped.ink, null)
  },

  'inference includes node centers and waypoints and JSX accepts node references'() {
    const result = new LayoutPass().layout(evaluate(`
      const a = <Node id="a" x={2} y={0}>A</Node>
      const b = <Node id="b" x={8} y={0}>B</Node>
      return <Network padding={0.5} width={px(600)} height={px(300)}>
        <Edge start={a} end={b} points={[[5, 1]]} />
        {a}
        {b}
      </Network>
    `))
    near(result.children[1].offset.x + result.children[1].fragment.size.width / 2, 150)
    near(result.children[2].offset.x + result.children[2].fragment.size.width / 2, 450)
    near(result.children[1].offset.y + result.children[1].fragment.size.height / 2, 225)
    assert.deepEqual(new LayoutPass().layout(new Network()).size, { width: 480, height: 320 })
    const shapes = new LayoutPass().layout(evaluate(`
      return <Network padding={0.5} width={px(600)} height={px(300)}>
        <Circle id="a" x={2} y={0} anchor="center" width={px(40)} />
        <Square id="b" x={8} y={0} anchor="center" width={px(40)} />
        <Edge start="a" end="b" />
      </Network>
    `))
    near(shapes.children[0].offset.x, 130)
    near(shapes.children[1].offset.x, 430)
  },

  'named components retain Edge behavior and zero-tension heads follow the shaft'() {
    const Link = define_component('Link', props => new Edge({ start: 'a', end: 'b', ...props }))
    const result = layout([new Link(), node('a', 0.2, 0.5), node('b', 0.8, 0.5)])
    assert.equal(result.children[0].fragment.name, 'Link')
    near_point(ends(result.children[0].fragment)[0], { x: 160, y: 150 })
    const straight = layout([new Edge({ start: 'a', end: 'b', tension: 0, head_open: true,
      start_side: 'top', end_side: 'top' }), node('a', 0.2, 0.5), node('b', 0.8, 0.5)])
    const [start, end] = ends(straight.children[0].fragment)
    near(start.y, end.y)
    const head = (straight.children[0].fragment.draw[1] as PathDraw).commands
    assert.ok((head[0] as Point).x < end.x)
    near_point(head[1] as Point, end)
  },

  'invalid references, duplicate ids, ports, and singular transforms fail clearly'() {
    assert.throws(() => new Node({ id: '' }), /nonempty string/)
    assert.throws(() => new Node({ text: 'Old label' } as unknown as import('../src/index').NodeProps), /Use children instead of text/)
    assert.throws(() => new Circle({ id: 7 as unknown as string }), /nonempty string/)
    assert.throws(() => new Edge({ start: new Circle(), end: 'b' }), /nonempty string/)
    assert.throws(() => new Edge({ start: new Node(), end: 'b' }), /nonempty string/)
    assert.throws(() => new LayoutPass().layout(new Edge({ start: 'a', end: 'b' })), /direct child of Network/)
    assert.throws(() => layout([node('a', 0, 0), node('a', 1, 1)]), /Duplicate node id: a/)
    assert.throws(() => layout([new Edge({ start: 'missing', end: 'b' }), node('b', 1, 1)]), /Unknown node id: missing/)
    for (const start_loc of [-0.1, 1.1, NaN, Infinity]) {
      assert.throws(() => layout([new Edge({ start: 'a', end: 'b', start_loc }),
        node('a', 0, 0), node('b', 1, 1)]), /finite|between 0 and 1/)
    }
    assert.throws(() => layout([new Edge({ start: 'a', end: 'b', start_side: 'north' as Side }),
      node('a', 0, 0), node('b', 1, 1)]), /Unknown connection side/)
    assert.throws(() => layout([new Edge({ start: 'a', end: 'b' }), node('b', 1, 1),
      new TransformBox({ matrix: [0, 0, 0, 1, 0, 0], children: node('a', 0, 0) })]), /singular transform/)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} network checks passed.`)
