import assert from 'node:assert/strict'
import {
  Graph, Plot, BarPlot, HBars, Svg, Box, Bars, CoordLine, Points, SymLine, HAxis, Text, Fonts,
  LayoutPass, define_element, make_fragment, shape_size, make_request, exact, px,
  infer_coordinates, map_point, unmap_point, linear_ticks, render_svg, evaluate,
} from '../src/index'
import type { Fragment, FontProvider, PathDraw, CoordinateSpec } from '../src/index'

function find(fragment: Fragment, name: string): Fragment {
  if (fragment.name === name) return fragment
  for (const child of fragment.children) {
    try { return find(child.fragment, name); } catch {}
  }
  throw new Error(`Missing ${name}`)
}
function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)
}
const fixed = make_request({ width: exact(200), height: exact(100) })

const tests: Record<string, () => void> = {
  'graph limits infer data, expand constants, ignore annotations, and isolate nested graphs'() {
    const line = new CoordLine({ points: [{ x: 2, y: 4 }, { x: 8, y: 4 }, null, { x: NaN, y: 1 }] })
    const coord = infer_coordinates([line, new Text({ children: ['A ', 'label'], x: 99 }),
      new Graph({ children: new CoordLine({ points: [{ x: -100, y: -100 }] }) })])
    assert.deepEqual(coord.xlim, [2, 8])
    assert.deepEqual(coord.ylim, [3.5, 4.5])
    assert.deepEqual(infer_coordinates([]).xlim, [0, 1])
    assert.deepEqual(infer_coordinates(line, { xlim: [10, 0], padding: 0.1 }).xlim, [10, 0])
    assert.deepEqual(infer_coordinates(line, { padding: { x: 0.1 } }).xlim, [1.4, 8.6])
    assert.throws(() => infer_coordinates(line, { ylim: [4, 4] }), /endpoints must differ/)
    assert.throws(() => infer_coordinates(line, { xlim: [0, Infinity] }), /finite/)
    assert.throws(() => infer_coordinates(line, { padding: -1 }), /nonnegative/)
  },

  'data padding shares Box shorthand forms across Graph, Plot, and BarPlot'() {
    const line = new CoordLine({ points: [[10, 30], [20, 50]] })
    const forms: CoordinateSpec['padding'][] = [
      [0.2, 0.4], { h: 0.2, v: 0.4 }, [0.4, 0.4, 0.2, 0.2],
      { t: 0.4, b: 0.4, l: 0.2, r: 0.2 }, { x: 0.2, y: 0.4 },
    ]
    const canonical = { top: 0.4, bottom: 0.4, left: 0.2, right: 0.2 }
    const pass = new LayoutPass()
    for (const padding of forms) {
      const coord = infer_coordinates(line, { padding })
      assert.deepEqual(coord.xlim, [8, 22])
      assert.deepEqual(coord.ylim, [22, 58])
      for (const Container of [Graph, Plot, BarPlot]) {
        const props = { ...(Container === BarPlot ? { values: [10, 20] } : {}), children: line }
        assert.deepEqual(pass.layout(new Container({ ...props, padding }), fixed),
          pass.layout(new Container({ ...props, padding: canonical }), fixed), Container.name)
      }
    }
    const jsx = evaluate('<Svg><BarPlot values={[10, 20]} padding={[0.2, 0.4]} /></Svg>')
    const named = evaluate('<Svg><BarPlot values={[10, 20]} padding={{h: 0.2, v: 0.4}} /></Svg>')
    assert.deepEqual(pass.layout(jsx), pass.layout(named))
  },

  'asymmetric data padding follows screen sides and preserves explicit limits'() {
    const line = new CoordLine({ points: [[10, 30], [20, 50]] })
    const padding = [0.2, 0.4, 0.2, 0.6] as const
    const coord = infer_coordinates(line, { padding })
    assert.deepEqual(coord.xlim, [8, 26])
    assert.deepEqual(coord.ylim, [22, 54])
    const flipped = infer_coordinates(line, { padding, flip_x: true, flip_y: false })
    assert.deepEqual(flipped.xlim, [4, 22])
    assert.deepEqual(flipped.ylim, [26, 58])
    assert.deepEqual(infer_coordinates(line, { padding: { h: 0.6, v: 0.4, l: 0.3, t: 0.2, left: 0.2 } }), coord)
    assert.deepEqual(infer_coordinates(line, { padding: { h: 0.2, l: 0 } }).xlim, [10, 22])
    const explicit = infer_coordinates(line, { padding, xlim: [20, 10] })
    assert.deepEqual(explicit.xlim, [20, 10])
    assert.deepEqual(explicit.ylim, coord.ylim)
    assert.deepEqual(infer_coordinates(line, { padding, coord: [20, 50, 10, 30] }).ylim, [50, 30])
  },

  'data padding rejects malformed tuples and nonnumeric or negative fractions'() {
    for (const padding of [[], [0], [0, 0, 0], [0, 0, 0, 0, 0], Array(2), [0, undefined]]) {
      assert.throws(() => infer_coordinates([], { padding: padding as CoordinateSpec['padding'] }), /exactly two.*or four/)
    }
    for (const padding of [[0, -0.1], { t: -0.1 }, { r: Infinity }, { h: NaN }, [px(2), 0]]) {
      assert.throws(() => infer_coordinates([], { padding: padding as CoordinateSpec['padding'] }), /padding\..*(finite|nonnegative)/)
    }
    const tuple: [number, number] = [0.2, 0.4]
    const plot = new BarPlot({ values: [10, 20], padding: tuple })
    const before = plot.props.coordinates
    tuple[0] = 1
    assert.deepEqual(plot.props.coordinates, before)
    assert.deepEqual(plot.props.padding, [0.2, 0.4])
    assert.ok(Object.isFrozen(plot.props.padding))
  },

  'coordinate mapping and inverse support directed limits, flips, and zero-frame diagnostics'() {
    const coord = infer_coordinates([], { coord: [10, -5, 0, 5], flip_y: false })
    const size = { width: 200, height: 100 }
    assert.deepEqual(map_point({ x: 8, y: 0 }, coord, size), { x: 40, y: 50 })
    assert.deepEqual(unmap_point({ x: 40, y: 50 }, coord, size), { x: 8, y: 0 })
    assert.deepEqual(map_point({ x: 8, y: 0 }, { ...coord, flip_x: true }, size), { x: 160, y: 50 })
    assert.throws(() => unmap_point({ x: 0, y: 0 }, coord, { width: 0, height: 10 }), /zero-sized/)
  },

  'custom graphable elements report source bounds without layout or engine policies'() {
    let layouts = 0
    const Custom = define_element('Custom', (_, query) => {
      layouts++
      assert.deepEqual(query.coordinates?.xlim, [3, 7])
      return make_fragment({ size: shape_size(query.request, query.sizing) })
    }, {}, { data_bounds: () => ({ xlim: [3, 7], ylim: [-2, 9] }) })
    const graph = new Graph({ children: new Custom() })
    assert.equal(layouts, 0)
    new LayoutPass().layout(graph, fixed)
    assert.equal(layouts, 1)
  },

  'reused marks distinguish coordinate contexts in the layout cache and keep pixel strokes'() {
    const line = new CoordLine({ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], stroke_width: px(3) })
    const pass = new LayoutPass()
    const a = pass.layout(new Graph({ xlim: [0, 10], ylim: [0, 10], children: line }), fixed)
    const b = pass.layout(new Graph({ xlim: [0, 20], ylim: [0, 10], children: line }), fixed)
    const c = pass.layout(new Graph({ xlim: [0, 10], ylim: [0, 10], children: line }), fixed)
    const first = a.children[0].fragment, second = b.children[0].fragment
    assert.notEqual(first, second)
    assert.equal(first, c.children[0].fragment)
    assert.deepEqual((first.draw[0] as PathDraw).commands, [{ kind: 'M', x: 0, y: 100 }, { kind: 'L', x: 200, y: 0 }])
    assert.equal((second.draw[0] as PathDraw).commands[1].kind, 'L')
    assert.equal(first.draw[0].stroke_width, 3)
    assert.equal(second.draw[0].stroke_width, 3)
    const wider = pass.layout(new Graph({ children: line }), make_request({ width: exact(400), height: exact(100) }))
    assert.equal(wider.children[0].fragment.draw[0].stroke_width, 3)
  },

  'graph annotations use data positions and markers retain fixed geometry on resize'() {
    const graph = new Graph({ xlim: [0, 10], ylim: [0, 10], children: [
      new Points({ points: [{ x: 5, y: 5 }], point_size: px(8) }),
      new Text({ children: 'middle', x: 5, y: 5, anchor: 'center', font_size: px(12) }),
    ] })
    const pass = new LayoutPass(), a = pass.layout(graph, fixed)
    const b = pass.layout(graph, make_request({ width: exact(400), height: exact(200) }))
    assert.deepEqual(a.children[0].fragment.children[0].fragment.size, { width: 8, height: 8 })
    assert.equal(a.children[0].fragment.children[0].fragment, b.children[0].fragment.children[0].fragment)
    near(a.children[1].offset.x + a.children[1].fragment.size.width / 2, 100)
    near(b.children[1].offset.y + b.children[1].fragment.size.height / 2, 100)
    assert.deepEqual(a.children[1].fragment.size, b.children[1].fragment.size)
  },

  'linear ticks handle decimal, reversed, tiny, empty, and explicit interval scales'() {
    assert.deepEqual(linear_ticks([0, 1], 6), [0, 0.2, 0.4, 0.6, 0.8, 1])
    assert.deepEqual(linear_ticks([1, -1], 5), [1, 0.5, 0, -0.5, -1])
    assert.deepEqual(linear_ticks([0, 10], 5, 3), [0, 3, 6, 9])
    assert.deepEqual(linear_ticks([0, 1], 0), [])
    assert.deepEqual(linear_ticks([0, 1], 1), [0.5])
    assert.ok(linear_ticks([1e-12, 9e-12]).every(Number.isFinite))
    assert.throws(() => linear_ticks([0, 1], 5, 0), /positive/)
    assert.throws(() => linear_ticks([0, 1], 5, 1e-10), /too many/)
    assert.throws(() => linear_ticks([0, 1], 2.5), /integer/)
  },

  'axes prepare formatted and rotated label elements once and report their extent'() {
    let calls = 0
    const axis = new HAxis({ lim: [0, 2], ticks: [0, 1, 2], rotate: -45,
      format: value => { calls++; return `Category ${value}`; } })
    assert.equal(calls, 3)
    const pass = new LayoutPass(), a = pass.layout(axis, fixed)
    pass.layout(axis, make_request({ width: exact(400), height: exact(150) }))
    assert.equal(calls, 3)
    assert.equal(a.children.length, 3)
    assert.ok(a.overflow.bottom > 20)
    assert.ok(a.overflow.left > 0)
    const text = new HAxis({ lim: [0, 2], ticks: [[0, '<first>'], [3, 'outside'], [2, 'last']] })
    const svg = render_svg(pass.layout(text, fixed))
    assert.match(svg, /&lt;first&gt;/)
    assert.ok(!svg.includes('outside'))
  },

  'axis label anchors attach rotated labels by a selected edge'() {
    const axis = new HAxis({ lim: [0, 1], ticks: [[0.5, 'Category']], rotate: -45,
      tick_size: px(0), label_offset: px(0), label_anchor: ['end', 'start'] })
    assert.deepEqual(axis.props.label_style?.anchor, ['end', 'start'])
    const fragment = new LayoutPass().layout(axis, fixed)
    const label = fragment.children[0]
    near(label.offset.x + label.fragment.size.width, 100)
    near(label.offset.y, 100)

    const plot = new Plot({ xlim: [0, 1], xticks: [[0.5, 'Category']],
      xaxis_rotate: -45, xaxis_label_anchor: ['end', 'start'] })
    assert.deepEqual((plot.props.axes[0] as HAxis).props.label_style?.anchor, ['end', 'start'])
    assert.throws(() => new LayoutPass().layout(new HAxis({
      ticks: [[0.5, 'Category']], label_anchor: 'stretch' as unknown as 'start',
    }), fixed), /label anchor selects a point/)
  },

  'axes can point ticks independently from labels'() {
    const axis = new HAxis({ lim: [0, 1], ticks: [0.5], side: 'bottom',
      tick_side: 'inner', tick_size: px(8), label_offset: px(4) })
    const fragment = new LayoutPass().layout(axis, fixed)
    const tick = fragment.draw[1] as PathDraw
    assert.deepEqual(tick.commands, [
      { kind: 'M', x: 100, y: 100 }, { kind: 'L', x: 100, y: 92 },
    ])
    assert.equal(fragment.children[0].offset.y, 104)
    const plot = new Plot({ axis_tick_side: 'inner' })
    assert.equal((plot.props.axes[0] as HAxis).props.tick_side, 'inner')
    assert.equal((plot.props.axes[1] as HAxis).props.tick_side, 'inner')
    new LayoutPass().layout(plot, fixed)
    const jsx = evaluate('<HAxis ticks={[0.5]} tick-side="top" />')
    const jsxTick = new LayoutPass().layout(jsx, fixed).draw[1] as PathDraw
    assert.deepEqual(jsxTick.commands[1], { kind: 'L', x: 100, y: 95 })
    assert.throws(() => new LayoutPass().layout(
      new HAxis({ tick_side: 'left' }), fixed), /Tick side must be parallel/)
  },

  'axis arrows forward scoped head geometry, shape, and paint options'() {
    const axis = new HAxis({ arrow: true, arrow_size: px(12), arrow_width: 1,
      arrow_open: true, arrow_curve: 0.7, arrow_barb: 'left',
      arrow_stroke: 'red', arrow_stroke_width: px(2) })
    assert.deepEqual(axis.props.arrow_style, {
      open: true, curve: 0.7, barb: 'left', stroke: 'red', stroke_width: px(2),
    })
    assert.deepEqual(axis.props.arrow_size, px(12))
    assert.equal(axis.props.arrow_width, 1)
    const fragment = new LayoutPass().layout(axis, fixed)
    const head = fragment.draw[1] as PathDraw
    assert.equal(head.fill, 'none')
    assert.equal(head.stroke, 'red')
    assert.equal(head.stroke_width, 2)
    assert.ok(head.commands.some(command => command.kind === 'C'))
    const plot = new Plot({ xaxis_arrow: true, xaxis_arrow_open: true })
    assert.deepEqual((plot.props.axes[0] as HAxis).props.arrow_style, { open: true })
    const jsx = evaluate('<HAxis arrow arrow-open arrow-barb="right" />')
    assert.equal((jsx as HAxis).props.arrow_style?.open, true)
    assert.equal((jsx as HAxis).props.arrow_style?.barb, 'right')
  },

  'plot fills its viewport and reserves measured margins for titles and large tick labels'() {
    const plot = new Plot({ title: 'A long title that can wrap when the plot becomes narrow',
      xlabel: 'Elapsed time', ylabel: 'Revenue', xlim: [0, 2], ylim: [0, 1000000],
      yticks: [[0, '$0'], [1000000, '$1,000,000']], children: new CoordLine({ points: [{ x: 0, y: 0 }, { x: 2, y: 1000000 }] }) })
    const pass = new LayoutPass(), wide = pass.layout(plot, make_request({ width: exact(600), height: exact(360) }))
    const narrow = pass.layout(plot, make_request({ width: exact(300), height: exact(360) }))
    assert.deepEqual(wide.size, { width: 600, height: 360 })
    assert.ok(wide.content!.x > 90)
    assert.ok(wide.content!.y > 30)
    assert.ok(narrow.content!.y > wide.content!.y)
    for (const fragment of [wide, narrow]) {
      assert.ok(fragment.content!.width > 0 && fragment.content!.height > 0)
      const svg = render_svg(fragment)
      assert.ok(!/NaN|Infinity/.test(svg))
    }
    const root = new LayoutPass().layout(evaluate('<Svg width={px(680)} height={px(420)}><Plot/></Svg>'))
    assert.deepEqual(root.children[0].fragment.size, root.size)
    assert.deepEqual(new LayoutPass().layout(new Graph()).size, { width: 480, height: 320 })
  },

  'frame bounds allocate the graph area and reserve decorations as an outset'() {
    const props = { title: 'Revenue', xlabel: 'Elapsed time', ylabel: 'Revenue', xlim: [0, 2], ylim: [0, 1000000],
      yticks: [[0, '$0'], [1000000, '$1,000,000']] } as const
    const pass = new LayoutPass()
    const outer = pass.layout(new Plot(props), make_request({ width: exact(600), height: exact(360) }))
    assert.equal(outer.outset, undefined)
    // The same graph area gets the same decorations, moved outside the allocation.
    const area = outer.content!
    const framed = pass.layout(new Plot({ ...props, bounds: 'frame' }),
      make_request({ width: exact(area.width), height: exact(area.height) }))
    assert.deepEqual(framed.size, { width: area.width, height: area.height })
    assert.deepEqual(framed.content, { x: 0, y: 0, width: area.width, height: area.height })
    near(framed.outset!.left, area.x); near(framed.outset!.top, area.y)
    near(framed.outset!.right, 600 - area.x - area.width); near(framed.outset!.bottom, 360 - area.y - area.height)
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      assert.ok(framed.overflow[side] <= framed.outset![side] + 1e-8)
    }
    assert.deepEqual(find(framed, 'Graph').size, find(outer, 'Graph').size)
    assert.throws(() => pass.layout(new Plot({ bounds: 'inner' as 'frame' })), /bounds/)

    // Differently sized tick labels no longer move the graph areas of stacked plots.
    const stack = pass.layout(evaluate(`<VStack gap={px(60)}>
      <Plot bounds="frame" width={px(300)} height={px(200)} ylim={[0, 1]} />
      <BarPlot bounds="frame" width={px(300)} height={px(200)} values={[1000000, 2000000]} />
    </VStack>`))
    assert.deepEqual(stack.size, { width: 300, height: 460 })
    assert.deepEqual(stack.children.map(child => child.fragment.content),
      [{ x: 0, y: 0, width: 300, height: 200 }, { x: 0, y: 0, width: 300, height: 200 }])
    const [first, second] = stack.children.map(child => child.fragment.outset!)
    assert.ok(second.left > first.left)
    near(stack.outset!.left, second.left); near(stack.outset!.top, first.top)
    near(stack.outset!.right, Math.max(first.right, second.right)); near(stack.outset!.bottom, second.bottom)
  },

  'hugging viewports grow by reserved outsets while established axes keep their size'() {
    const plot = new Plot({ bounds: 'frame', width: px(300), height: px(200), title: 'Title' })
    const pass = new LayoutPass(), { outset } = pass.layout(plot)
    const root = pass.layout(new Svg({ children: plot }))
    assert.deepEqual(root.size, { width: 300 + outset!.left + outset!.right, height: 200 + outset!.top + outset!.bottom })
    assert.deepEqual(root.children[0].offset, { x: outset!.left, y: outset!.top })
    assert.equal(root.outset, undefined)
    const ink = root.children[0].fragment.ink!
    assert.ok(ink.x + outset!.left >= 0 && ink.y + outset!.top >= 0)
    // Padding absorbs part of the outset; the viewport adds only the remainder.
    const padded = pass.layout(new Svg({ children: new Box({ padding: px(10), children: plot }) }))
    assert.deepEqual(padded.size, { width: root.size.width, height: root.size.height })
    assert.equal(pass.layout(new Box({ padding: px(1000), children: plot })).outset, undefined)
    assert.equal(pass.layout(new Box({ clip: true, children: plot })).outset, undefined)
    const wide = pass.layout(new Svg({ width: px(300), children: plot }))
    assert.equal(wide.size.width, 300)
    assert.deepEqual(wide.children[0].offset, { x: 0, y: outset!.top })
    const exact_root = pass.layout(new Svg({ children: plot }), make_request({ width: exact(300), height: exact(200) }))
    assert.deepEqual(exact_root.size, { width: 300, height: 200 })
    assert.deepEqual(exact_root.children[0].offset, { x: 0, y: 0 })
  },

  'plot resizes without rerunning sample callbacks or reshaping prepared text'() {
    const fonts = new Fonts(); let shapes = 0, samples = 0
    const provider: FontProvider = { resolve(...args) {
      const font = fonts.resolve(...args)
      return { ...font, shape(text) { shapes++; return font.shape(text); } }
    } }
    const line = new SymLine({ fy: x => { samples++; return x * x; }, xlim: [0, 1], samples: 25 })
    const plot = new Plot({ title: 'Squared', xlabel: 'x', ylabel: 'y', children: line })
    const before = JSON.stringify(plot), pass = new LayoutPass({ fonts: { value: provider, version: 0 } })
    pass.layout(plot, make_request({ width: exact(600), height: exact(400) }))
    const count = shapes
    pass.layout(plot, make_request({ width: exact(400), height: exact(300) }))
    assert.equal(shapes, count)
    assert.equal(samples, 25)
    assert.equal(JSON.stringify(plot), before)
  },

  'bars include widths and bases in limits and map negative horizontal values correctly'() {
    let styles = 0
    const bars = new HBars({ values: [3, -2], positions: [2, 4], bases: [1, 0], bar_width: 0.5,
      styles: value => { styles++; return { fill: value > 0 ? 'blue' : 'red' }; } })
    const coord = infer_coordinates(bars)
    assert.deepEqual(coord.xlim, [-2, 3])
    assert.deepEqual(coord.ylim, [1.75, 4.25])
    const graph = new LayoutPass().layout(new Graph({ xlim: [-2, 3], ylim: [0, 5], children: bars }), fixed)
    const draw = graph.children[0].fragment.draw
    assert.equal(draw[1].kind, 'rect')
    if (draw[1].kind === 'rect') {
      near(draw[1].rect.x, 0); near(draw[1].rect.width, 80)
      near(draw[1].rect.y, 15); near(draw[1].rect.height, 10)
    }
    assert.equal(draw[1].fill, 'red')
    assert.equal(styles, 2)
    assert.throws(() => new Bars({ values: [1, 2], bar_width: [1] }), /match/)
    assert.throws(() => new Bars({ values: [1], bar_width: -1 }), /nonnegative/)
    const source = new BarPlot({ values: [1, 2], fill: 'green', xticks: [[0, 'A'], [1, 'B']] })
    const result = find(new LayoutPass().layout(source), 'Bars')
    assert.equal(result.draw.length, 2)
    assert.equal(result.draw[0].fill, 'green')
  },

  'data clipping preserves overflow while axes and labels remain outside the clip'() {
    const source = new Plot({ xlim: [0, 1], ylim: [0, 1], children:
      new CoordLine({ points: [{ x: -1, y: 0.5 }, { x: 2, y: 0.5 }] }) })
    const root = new LayoutPass().layout(source, make_request({ width: exact(400), height: exact(300) }))
    const graph = find(root, 'Graph')
    assert.ok(graph.clip)
    assert.ok(graph.overflow.left > 0 && graph.overflow.right > 0)
    assert.equal(find(root, 'HAxis').clip, undefined)
    const zero = new LayoutPass().layout(source, make_request({ width: exact(0), height: exact(0) }))
    assert.deepEqual(zero.size, { width: 0, height: 0 })
    assert.ok(!/NaN|Infinity/.test(render_svg(zero)))
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} plotting checks passed.`)
