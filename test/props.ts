import assert from 'node:assert/strict'
import {
  Arrow, Axis, HAxis, Label, Plot, BarPlot, Legend, LegendItem, Bullets, OuterLabel,
  TitleBox, TitleFrame, TextFigure, Slide, Text, Rect,
  LayoutPass, element_children, prefix_split, prefix_join, evaluate, render_svg, make_request, exact, px, em,
} from '../src/index'
import type { Element, ArrowProps, ArrowHeadStyle, Prefixed, StyleSpec } from '../src/index'

const fixed = make_request({ width: exact(400), height: exact(240) })
function svg(element: Element) { return render_svg(new LayoutPass().layout(element, fixed)); }
function children(element: Element) { return element_children(element.props.children); }
function texts(element: Element): Text[] {
  return element instanceof Text ? [element] : children(element).flatMap(texts)
}

const tests: Record<string, () => void> = {
  'content props no longer replace children'() {
    assert.throws(() => new LayoutPass().layout(new Text({ text: 'old' } as any)), /children instead of text/)
    assert.throws(() => new Bullets({ items: ['old'] } as any), /children instead of items/)
    assert.throws(() => new Label({ label: 'old' } as any), /children instead of label/)
    assert.throws(() => new OuterLabel({ label: 'old' } as any), /children instead of label/)
    assert.throws(() => new Legend({ entries: [] } as any), /children instead of entries/)
  },
  'prefix helpers preserve values, reserve owner keys, and prefer the longest scope'() {
    const format = (value: number) => String(value), size = px(12)
    const props = Object.freeze({ tick: false, tick_size: size, tick_stroke: 'red',
      tick_label_color: 'blue', tick_label_format: format, tick_label_wrap: false,
      opacity: 0, ticklabel_color: 'green', absent: undefined })
    const [tick, label, rest] = prefix_split(['tick', 'tick_label'], props, ['tick_size'])
    assert.deepEqual(tick, { stroke: 'red' })
    assert.deepEqual(label, { color: 'blue', format, wrap: false })
    assert.deepEqual(rest, { tick: false, tick_size: size, opacity: 0, ticklabel_color: 'green', absent: undefined })
    assert.equal(rest.tick_size, size)
    assert.equal(label.format, format)
    assert.deepEqual(prefix_split(['tick_label', 'tick'], props, ['tick_size']), [label, tick, rest])
    assert.deepEqual({ ...prefix_join('tick', tick), ...prefix_join('tick_label', label), ...rest }, props)
    assert.deepEqual(prefix_split([], props), [props])
    assert.equal(props.tick_label_color, 'blue')
  },

  'scoped arrow options preserve geometry and agree with nested objects and dashed JSX'() {
    const base: ArrowProps = { points: [[0.1, 0.9], [0.4, 0.1], [0.9, 0.6]], curve: true,
      start_head: true, head_size: px(20), head_width: 1, head_curve: 0.7, stroke: 'red', stroke_width: px(5) }
    const style = { fill: 'blue', stroke: 'green', stroke_width: px(2), opacity: 0.5, curve: 0.7 }
    const arrow = new Arrow({ ...base, head_style: { fill: 'red', stroke: 'green' },
      head_fill: 'blue', head_stroke_width: px(2), head_opacity: 0.5 })
    assert.equal(svg(arrow), svg(new Arrow({ ...base, head_style: style })))
    assert.deepEqual(arrow.props.head_style, style)
    assert.deepEqual(arrow.props.head_size, px(20))
    assert.equal(arrow.props.head_width, 1)
    assert.equal(arrow.props.head_style?.curve, 0.7)
    assert.ok(!Object.hasOwn(arrow.props, 'head_fill'))
    assert.ok(Object.isFrozen(arrow.props.head_style))
    const dashed = evaluate('<Arrow curve head-curve={0.7} head-fill="blue" head-stroke-width={px(2)} head-size={px(20)} />')
    assert.equal(svg(dashed), svg(new Arrow({ curve: true, head_curve: 0.7,
      head_fill: 'blue', head_stroke_width: px(2), head_size: px(20) })))
    assert.equal(svg(new Arrow({ head_style: { fill: 'blue' }, head_fill: undefined })),
      svg(new Arrow({ head_style: { fill: undefined } })))
    const open = evaluate('<Arrow curve head-open head-curve={0.7} head-barb="left" head-stroke="blue" head-size={px(20)} />')
    assert.equal(svg(open), svg(new Arrow({ curve: true, head_size: px(20),
      head_style: { open: true, curve: 0.7, barb: 'left', stroke: 'blue' } })))
    const overridden = new Arrow({ head_style: { open: true, curve: 1, stroke: 'red' },
      head_open: false, head_curve: 0, head_stroke: 'blue' })
    assert.deepEqual(overridden.props.head_style, { open: false, curve: 0, stroke: 'blue' })
  },

  'canonical class defaults and explicit undefined keep their construction semantics'() {
    class RedHead extends Arrow {
      static defaults: Partial<ArrowProps> = { head_style: { fill: 'red' }, head_size: px(20) }
    }
    assert.deepEqual(new RedHead().props.head_style, { fill: 'red' })
    assert.deepEqual(new RedHead({ head_fill: 'blue' }).props.head_style, { fill: 'blue' })
    const cleared = new RedHead({ head_style: undefined, head_size: undefined })
    assert.equal(cleared.props.head_style, undefined)
    assert.equal(cleared.props.head_size, undefined)
    assert.ok(Object.hasOwn(cleared.props, 'head_size'))
    class OpenHead extends Arrow {
      static defaults: Partial<ArrowProps> = { head_open: true, head_curve: 0.7 }
    }
    assert.equal(svg(new OpenHead()), svg(new Arrow({ head_open: true, head_curve: 0.7 })))
    assert.equal(svg(new OpenHead({ head_open: false, head_curve: 0 })), svg(new Arrow()))
  },

  'axis scopes keep owner geometry and typography while accepting text options'() {
    const base = { ticks: [[0, 'First'], [1, 'Last']] as const,
      tick_size: px(8), tick_side: 'top' as const, label_offset: px(6),
      line_height: em(1.7), font_size: px(13) }
    const axis = new HAxis({ ...base, line_stroke: 'blue', tick_stroke_width: px(3),
      label_color: 'red', label_wrap: false, label_justify: 'end' })
    assert.equal(svg(axis), svg(new HAxis({ ...base, line_style: { stroke: 'blue' },
      tick_style: { stroke_width: px(3) }, label_style: { color: 'red', wrap: false, justify: 'end' } })))
    assert.deepEqual(axis.props.line_height, em(1.7))
    assert.deepEqual(axis.props.tick_size, px(8))
    assert.equal(axis.props.tick_side, 'top')
    assert.deepEqual(axis.props.label_offset, px(6))
    const arrow = new HAxis({ arrow: true, arrow_style: { open: true, stroke: 'red' },
      arrow_open: false, arrow_curve: 0.7 })
    assert.deepEqual(arrow.props.arrow_style, { open: false, stroke: 'red', curve: 0.7 })
    assert.equal((axis.props.items[0].label as Text).props.wrap, false)
    assert.equal(svg(new Label({ children: 'A label', label_color: 'red', label_wrap: false })),
      svg(new Label({ children: 'A label', label_style: { color: 'red', wrap: false } })))
  },

  'plot merges shared and specific scopes per field across nested and flat spellings'() {
    const plot = new Plot({ xlim: [0, 1], ylim: [0, 1], xlabel: 'X', ylabel: 'Y', title: 'Title',
      label_gap: px(9), line_height: em(1.6),
      label_style: { color: 'red', font_size: px(11) },
      axis_style: { label_color: 'blue', tick_style: { stroke: 'red', stroke_width: px(1) } },
      axis_label_style: { color: 'green' }, axis_tick_stroke: 'green',
      xaxis: { label_style: { color: 'purple', font_weight: 700 }, tick_style: { stroke_dasharray: [px(2)] } },
      xaxis_label_color: 'navy', xaxis_tick_stroke_width: px(4), xaxis_tick_size: px(8),
      xlabel_color: 'purple', ylabel_font_weight: 700, title_wrap: false,
      grid: true, grid_style: { stroke: 'gray', stroke_width: px(2) }, xgrid_stroke: 'blue',
      legend: [{ label: 'Sample' }], legend_style: { label_color: 'red', label_style: { font_size: px(10) } },
      legend_label_style: { color: 'green' }, legend_label_font_weight: 700 })
    const [x, y] = plot.props.axes as readonly HAxis[]
    assert.deepEqual(x.props.label_style, { color: 'navy', font_size: px(11), font_weight: 700 })
    assert.deepEqual(y.props.label_style, { color: 'green', font_size: px(11) })
    assert.deepEqual(x.props.tick_style, { stroke: 'green', stroke_width: px(4), stroke_dasharray: [px(2)] })
    assert.deepEqual(y.props.tick_style, { stroke: 'green', stroke_width: px(1) })
    assert.deepEqual(x.props.tick_size, px(8))
    assert.deepEqual(plot.props.label_gap, px(9))
    assert.deepEqual(plot.props.line_height, em(1.6))
    assert.equal(plot.props.x_label!.props.color, 'purple')
    assert.equal(children(plot.props.y_label!)[0].props.color, 'red')
    assert.equal(children(plot.props.y_label!)[0].props.font_weight, 700)
    assert.equal((plot.props.title_element as Text).props.wrap, false)
    assert.equal(plot.props.meshes[0].props.stroke, 'blue')
    assert.equal(plot.props.meshes[1].props.stroke, 'gray')
    assert.deepEqual(plot.props.meshes[0].props.stroke_width, px(2))
    const legend = texts(plot.props.legend_element!)[0]
    assert.equal(legend.props.color, 'green')
    assert.equal(legend.props.font_weight, 700)
    assert.deepEqual(legend.props.font_size, px(10))
    assert.doesNotMatch(svg(plot), /NaN|Infinity/)
  },

  'scoped axis callbacks run once and resize retains source and fragment identities'() {
    let calls = 0
    const plot = new Plot({ xlim: [0, 1], ylim: [0, 1], xticks: [0, 1], yticks: [0, 1],
      axis_format: value => { calls++; return `Value ${value}`; },
      xaxis_label_color: 'blue', yaxis_label_color: 'red' })
    assert.equal(calls, 4)
    const axes = plot.props.axes, labels = axes.map(axis => (axis as HAxis).props.items[0].label)
    const snapshot = JSON.stringify(plot), pass = new LayoutPass()
    const first = pass.layout(plot, fixed)
    assert.equal(pass.layout(plot, fixed), first)
    pass.layout(plot, make_request({ width: exact(600), height: exact(300) }))
    assert.equal(calls, 4)
    assert.equal(plot.props.axes, axes)
    labels.forEach((label, i) => assert.equal((axes[i] as HAxis).props.items[0].label, label))
    assert.equal(JSON.stringify(plot), snapshot)
    assert.ok(!Object.hasOwn(plot.props, 'axis_format'))
    assert.ok(!Object.hasOwn(axes[0].props, 'format'))
    const disabled = new Plot({ axis: false, xaxis_label_color: 'red',
      xaxis_format: () => { throw new Error('Disabled axis formatter ran'); } })
    assert.equal(disabled.props.axes.length, 0)
    const bars = new BarPlot({ values: [1, 2], xaxis_tick_size: px(8), title: 'Bars', title_color: 'blue' })
    assert.deepEqual((bars.props.axes[0] as HAxis).props.tick_size, px(8))
    assert.equal(bars.props.title_element!.props.color, 'blue')
  },

  'document scopes expose wrapping and preserve explicit content element identities'() {
    const content = new Rect({ width: px(40), height: px(20) })
    const common = { title: 'A title with several words', width: px(90), padding: px(0), children: content }
    const pass = new LayoutPass()
    const wrapped = pass.layout(new TitleBox(common))
    const unwrapped = pass.layout(new TitleBox({ ...common, title_wrap: false }))
    assert.ok(wrapped.size.height > unwrapped.size.height)
    assert.equal(svg(new TitleFrame({ ...common, title_color: 'blue', title_font_size: px(14) })),
      svg(new TitleFrame({ ...common, title_style: { color: 'blue', font_size: px(14) } })))
    assert.equal(svg(new TextFigure({ children: content, caption: 'Caption', caption_wrap: false, caption_color: 'blue' })),
      svg(new TextFigure({ children: content, caption: 'Caption', caption_style: { wrap: false, color: 'blue' } })))
    assert.equal(svg(new Slide({ title: 'Slide', children: 'Body', title_color: 'blue', title_wrap: false })),
      svg(new Slide({ title: 'Slide', children: 'Body', title_style: { color: 'blue', wrap: false } })))
    const title = new Text({ children: 'Explicit', color: 'purple' })
    assert.equal(texts(new TitleBox({ title, title_color: 'red' }))[0], title)
    assert.equal(texts(new TextFigure({ caption: title, caption_color: 'red' }))[0], title)
    assert.equal(texts(new Slide({ title, title_color: 'red' }).props.body)[0], title)
    assert.equal(texts(new Legend({ children: new LegendItem({ children: title }), label_color: 'red' }))[0], title)
    const plot = new Plot({ title, title_color: 'red', legend: title, legend_color: 'red' })
    assert.equal(plot.props.title_element, title)
    assert.equal(plot.props.legend_element, title)
    assert.equal(title.props.color, 'purple')
  },

  'custom JSX components can use the public split and join helpers'() {
    const scene = evaluate(`
      const Captioned = props => {
        const [caption, rest] = prefix_split(['caption'], props)
        return <TextFigure {...rest} caption_style={caption} />
      }
      return <Captioned caption="A caption" caption-color="blue">
        <Arrow {...prefix_join('head', { fill: 'red' })} />
      </Captioned>
    `)
    const expected = new TextFigure({ caption: 'A caption', caption_style: { color: 'blue' },
      children: new Arrow({ head_style: { fill: 'red' } }) })
    assert.equal(svg(scene), svg(expected))
  },
}

// Public names and helper results remain statically checked, including overlaps.
if (false) {
  const props: Prefixed<'head', StyleSpec> = { head_fill: 'blue', head_stroke_width: px(2) }
  new Arrow(props)
  const head: Prefixed<'head', ArrowHeadStyle> = { head_open: true, head_curve: 0.7, head_barb: 'left', head_stroke: 'blue' }
  new Arrow(head)
  // @ts-expect-error open is a shape option with a boolean value
  new Arrow({ head_open: 'yes' })
  new Plot({ xaxis_tick_size: px(8), xaxis_label_wrap: false, title_wrap: false })
  const [tick, label, rest] = prefix_split(['tick', 'tick_label'],
    { tick_size: px(8), tick_label_color: 'red' }, ['tick_size'])
  const color: string = label.color
  new Axis({ tick_size: rest.tick_size, label_color: color })
  // @ts-expect-error the longer scope claims this property
  tick.label_color
  // @ts-expect-error a reserved owner key is not a scoped property
  tick.size
  // @ts-expect-error scoped paint retains its supported length units
  new Arrow({ head_stroke_width: '2rem' })
  // @ts-expect-error unknown child property
  new Plot({ xaxis_label_colro: 'red' })
  // @ts-expect-error text options retain boolean types
  new TitleBox({ title_wrap: 3 })
  const joined = prefix_join('label', { color: 'red' })
  new Axis({ label_color: joined.label_color })
  // @ts-expect-error joined keys have a prefix
  joined.color
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} scoped prop checks passed.`)
