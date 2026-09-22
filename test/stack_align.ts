import assert from 'node:assert/strict'
import {
  HStack, VStack, TextRow, TextCol, TextStack, Box, Rect, Text, Fonts, LayoutPass,
  define_element, evaluate, px, make_request, exact, make_size, make_fragment, finish_size,
} from '../src/index'
import type { ElementProps, FontProvider, StackAlign } from '../src/index'

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

const Guided = define_element<ElementProps & { baseline?: number }>('Guided', (props, query) =>
  make_fragment({ size: finish_size(make_size(10, 10), query.request, query.sizing),
    guides: props.baseline === undefined ? {} : { baseline: props.baseline } }))
const paragraph = 'A paragraph wraps at its allocated width while its neighbors keep their own alignment. '
  + 'Stretch changes its allocation without scaling the text or measuring the glyphs again.'

const tests: Record<string, () => void> = {
  'align_self overrides the parent on either cross axis and preserves explicit zero'() {
    for (const Container of [HStack, VStack]) {
      const values: readonly (StackAlign | undefined)[] = [undefined, 'start', 'center', 'end', 0.25, 0, 1]
      const props = { width: px(10), height: px(10) }
      const source = new Container({ width: px(100), height: px(100), align: 'end', children: [
        new Box(props), ...values.map(align_self => new Box({ ...props, align_self })),
      ] })
      const pass = new LayoutPass(), fragment = pass.layout(source)
      const axis = Container === HStack ? 'y' : 'x'
      assert.deepEqual(fragment.children.map(child => child.offset[axis]), [90, 90, 0, 45, 90, 22.5, 0, 90])
      assert.ok(fragment.children.every(child => child.fragment.size.width === 10 && child.fragment.size.height === 10))
      assert.deepEqual(pass.stats, { queries: 9, layouts: 9, hits: 0 })
    }
  },

  'children opt into and out of stretch without changing main-axis allocations'() {
    for (const Container of [HStack, VStack]) {
      for (const align of ['start', 'stretch'] as const) {
        const values = [undefined, 'start', 'center', 'end', 'stretch'] as const
        const source = new Container({ width: px(100), height: px(100), align,
          children: values.map(align_self => new Box({ width: px(20), height: px(20),
            max_width: px(30), max_height: px(30), align_self })) })
        const fragment = new LayoutPass().layout(source)
        const cross = Container === HStack ? 'height' : 'width'
        const main = Container === HStack ? 'width' : 'height'
        const axis = Container === HStack ? 'y' : 'x'
        assert.deepEqual(fragment.children.map(child => child.fragment.size[cross]),
          [align === 'stretch' ? 100 : 20, 20, 20, 20, 100])
        assert.deepEqual(fragment.children.map(child => child.fragment.size[main]), [20, 20, 20, 20, 20])
        assert.deepEqual(fragment.children.map(child => child.offset[axis]), [0, 0, 40, 80, 0])
      }
    }
  },

  'natural columns reflow only stretching children before allocating heights'() {
    const pass = new LayoutPass()
    const stretch = new Text({ children: paragraph, max_width: px(80), align_self: 'stretch' })
    const end = new Text({ children: paragraph, max_width: px(80), align_self: 'end' })
    const natural = pass.layout(end)
    const source = new VStack({ gap: px(4), children: [stretch,
      new Box({ width: px(200), height: px(10) }), end] })
    const column = pass.layout(source), text = column.children[0].fragment
    assert.equal(column.size.width, 200)
    assert.equal(text.size.width, 200)
    assert.equal(column.children[2].fragment, natural)
    near(column.children[2].offset.x, 200 - natural.size.width)
    assert.ok(text.size.height < natural.size.height)
    near(column.size.height, text.size.height + natural.size.height + 18)
    near(column.children[2].offset.y, text.size.height + 18)

    const fixed = pass.layout(new VStack({ height: px(100), children: [
      new Box({ width: px(40), basis: px(10), grow: 1, align_self: 'stretch' }),
      new Box({ width: px(120), height: px(20) }),
    ] }))
    assert.deepEqual(fixed.size, { width: 120, height: 100 })
    assert.deepEqual(fixed.children[0].fragment.size, { width: 120, height: 80 })
  },

  'mixed rows stretch after text reflow and reuse prepared glyphs across resizing'() {
    const fonts = new Fonts()
    let shapes = 0
    const provider: FontProvider = { resolve(family, weight, style) {
      const font = fonts.resolve(family, weight, style)
      return { ...font, shape(text) { shapes++; return font.shape(text); } }
    } }
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } })
    const source = new HStack({ align: 'stretch', children: [
      new Text({ children: paragraph, basis: 0, grow: 1 }),
      new Box({ width: px(20), height: px(5), align_self: 'end' }),
      new Box({ width: px(10), height: px(1), align_self: 'stretch' }),
    ] })
    const before = JSON.stringify(source)
    const wide = pass.layout(source, make_request({ width: exact(200) })), count = shapes
    const request = make_request({ width: exact(120) })
    const narrow = pass.layout(source, request)
    for (const row of [wide, narrow]) {
      assert.deepEqual(row.children.map(child => child.fragment.size.width), [row.size.width - 30, 20, 10])
      near(row.children[0].fragment.size.height, row.size.height)
      near(row.children[2].fragment.size.height, row.size.height)
      assert.equal(row.children[1].fragment.size.height, 5)
      near(row.children[1].offset.y, row.size.height - 5)
      assert.ok(row.children.every(child => child.transform === undefined))
    }
    assert.ok(narrow.size.height > wide.size.height)
    assert.equal(shapes, count)
    assert.equal(pass.layout(source, request), narrow)
    assert.equal(JSON.stringify(source), before)
  },

  'only baseline participants determine the baseline group and its stretch height'() {
    const pass = new LayoutPass()
    for (const align of ['center', 'baseline'] as const) {
      const align_self = align === 'baseline' ? undefined : 'baseline'
      const source = new HStack({ align, children: [
        new Guided({ height: px(5), baseline: 200, align_self: 'end' }),
        new Guided({ height: px(10), baseline: 20, align_self }),
        new Guided({ height: px(20), baseline: 5, align_self }),
        new Box({ width: px(10), height: px(12), align_self }),
        new Box({ width: px(10), height: px(2), align_self: 'stretch' }),
        new Box({ width: px(10), height: px(25), align_self: 'center' }),
      ] })
      const row = pass.layout(source)
      assert.equal(row.size.height, 35)
      assert.equal(row.guides.baseline, 20)
      assert.deepEqual(row.children.map(child => child.offset.y), [30, 0, 15, 8, 0, 5])
      assert.equal(row.children[4].fragment.size.height, 35)
      const small = pass.layout(source, make_request({ height: exact(20) }))
      assert.deepEqual(small.children.map(child => child.offset.y), [15, 0, 15, 8, 0, -2.5])
      assert.equal(small.children[4].fragment.size.height, 20)
      assert.equal(small.overflow.top, 2.5)
      assert.equal(small.overflow.bottom, 15)
    }
    const opted_out = pass.layout(new HStack({ align: 'baseline', children: [
      new Guided({ height: px(10), baseline: 3, align_self: 'end' }),
      new Box({ width: px(10), height: px(20), align_self: 'start' }),
    ] }))
    assert.equal(opted_out.guides.baseline, 13)
  },

  'a selected column width remains stable when non-stretch flex children grow wider'() {
    const pass = new LayoutPass()
    const column = pass.layout(new VStack({ height: px(100), children: [
      new Box({ width: px(40), basis: 0, grow: 1, align_self: 'stretch' }),
      new Rect({ aspect: 2, basis: px(10), grow: 1, align_self: 'end', stroke: 'none' }),
    ] }))
    assert.deepEqual(column.size, { width: 40, height: 100 })
    assert.deepEqual(column.children.map(child => child.fragment.size),
      [{ width: 40, height: 45 }, { width: 110, height: 55 }])
    assert.equal(column.children[1].offset.x, -70)
    assert.equal(column.overflow.left, 70)

    const references: unknown[] = []
    const Probe = define_element('Probe', (_, query) => {
      references.push(query.measure.reference)
      return make_fragment({ size: finish_size(make_size(50, 10), query.request, query.sizing) })
    })
    pass.layout(new VStack({ children: [new Probe({ align_self: 'stretch' }), new Box({ width: px(200) })] }))
    assert.deepEqual(references, [{}, {}])
  },

  'align_self belongs to the direct container and remains separate from child alignment'() {
    const pass = new LayoutPass()
    const child = new Box({ width: px(40), height: px(20), align: 'end', align_self: 'end',
      children: new Box({ width: px(10), height: px(10) }) })
    const column = pass.layout(new VStack({ width: px(100), children: child }))
    assert.equal(column.children[0].offset.x, 60)
    assert.deepEqual(column.children[0].fragment.children[0].offset, { x: 30, y: 10 })
    const box = pass.layout(new Box({ width: px(100), children: child }))
    assert.equal(box.children[0].offset.x, 60)
    const nested = pass.layout(new VStack({ width: px(100), children:
      new VStack({ width: px(40), align_self: 'end', children: new Box({ width: px(10), height: px(10) }) }) }))
    assert.equal(nested.children[0].offset.x, 60)
    assert.equal(nested.children[0].fragment.children[0].offset.x, 0)
    for (const Container of [VStack, TextCol, TextStack]) {
      const fragment = pass.layout(new Container({ width: px(100), children:
        new Box({ width: px(10), height: px(10), align_self: 'end' }) }))
      assert.equal(fragment.children[0].offset.x, 90)
      assert.equal(fragment.children[0].fragment.size.width, 10)
    }
    const row = pass.layout(new TextRow({ height: px(100), children:
      new Box({ width: px(10), height: px(10), align_self: 'center' }) }))
    assert.equal(row.children[0].offset.y, 45)
  },

  'JSX supports align-self and invalid overrides identify the child property'() {
    const pass = new LayoutPass()
    const source = evaluate(`<VStack width={px(100)} align="center">
      <Box width={px(20)} height={px(10)} align-self="end" />
      <Box width={px(20)} height={px(10)} align_self={0} />
      <Box width={px(20)} height={px(10)} />
    </VStack>`)
    assert.deepEqual(pass.layout(source).children.map(child => child.offset.x), [80, 0, 40])
    for (const align_self of [-0.1, 1.1, NaN, Infinity, 'auto', 'unknown', [], ['center'], true, null]) {
      assert.throws(() => pass.layout(new HStack({ children:
        new Box({ align_self: align_self as StackAlign }) })), /HStack\/Box\[0\].align_self/)
    }
    assert.throws(() => pass.layout(new VStack({ children: new Box({ align_self: 'baseline' }) })),
      /VStack\/Box\[0\].align_self.*available on HStack/)
    const zero = pass.layout(new HStack({ height: px(0), children: [
      new Box({ width: px(10), height: px(20), align_self: 'stretch' }),
      new Box({ width: px(10), height: px(20), align_self: 'center' }),
    ] }))
    assert.equal(zero.children[0].fragment.size.height, 0)
    assert.equal(zero.children[1].offset.y, -10)
    assert.equal(zero.overflow.top, 10)
    assert.equal(zero.overflow.bottom, 10)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} child alignment checks passed.`)

if (false) {
  new Box({ align_self: ['start', 'end'] })
  new Rect({ align_self: { x: 'end' } })
  // @ts-expect-error Omit the override to use the parent; there is no auto value.
  new Text({ align_self: 'auto' })
}
