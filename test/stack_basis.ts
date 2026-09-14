import assert from 'node:assert/strict'
import {
  HStack, VStack, TextFrame, Box, LayoutPass, evaluate,
  px, em, available, exact, make_request,
} from '../src/index'
import type { Axis, ElementProps, Fragment, FlexSpec } from '../src/index'
import { Fixed } from './fixtures/leaves'

const lengths = (fragment: Fragment, axis: Axis = 'width') =>
  fragment.children.map(child => child.fragment.size[axis])
const leaf = (axis: Axis, length: number, props: ElementProps = {}) => new Fixed({
  content_width: px(axis === 'width' ? length : 20),
  content_height: px(axis === 'height' ? length : 20), ...props,
})

const tests: Record<string, () => void> = {
  'unsized growth shares finite budgets but retains natural bases without a budget'() {
    for (const Container of [HStack, VStack]) {
      const axis = Container === HStack ? 'width' : 'height'
      const source = new Container({ children: [40, 80].map(size => leaf(axis, size, { grow: 1 })) })
      const before = JSON.stringify(source), pass = new LayoutPass()
      assert.deepEqual(lengths(pass.layout(source), axis), [40, 80])
      for (const offer of [available, exact]) {
        for (const budget of [0, 100, 300]) {
          const request = make_request({ [axis]: offer(budget) })
          const result = pass.layout(source, request)
          assert.deepEqual(lengths(result, axis), [budget / 2, budget / 2])
          assert.equal(pass.layout(source, request), result)
        }
      }
      assert.deepEqual(lengths(pass.layout(source), axis), [40, 80])
      assert.equal(JSON.stringify(source), before)
      const zero = pass.layout(new Container({ children:
        [40, 80].map(size => leaf(axis, size, { grow: 1, basis: 0 })) }))
      assert.deepEqual(lengths(zero, axis), [0, 0])
      assert.equal(zero.overflow[axis === 'width' ? 'right' : 'bottom'], 80)
    }
  },

  'explicit dimensions and bases take precedence on each main axis'() {
    for (const Container of [HStack, VStack]) {
      const axis = Container === HStack ? 'width' : 'height'
      const cases: [ElementProps, number[]][] = [
        [{ [axis]: px(60) }, [180, 120]],
        [{ [axis]: 0.5 }, [225, 75]],
        [{ [axis]: em(2), font_size: px(30) }, [180, 120]],
        [{ [axis]: px(60), basis: 'auto' }, [180, 120]],
        [{ [axis]: px(60), basis: px(20) }, [160, 140]],
        [{ [axis]: px(60), basis: 0 }, [150, 150]],
        [{ basis: 0.2 }, [180, 120]],
      ]
      for (const [props, expected] of cases) {
        const result = new LayoutPass().layout(new Container({ [axis]: px(300), children: [
          leaf(axis, 40, { grow: 1, ...props }), leaf(axis, 80, { grow: 1 }),
        ] }))
        assert.deepEqual(lengths(result, axis), expected)
      }
    }
  },

  'auto and fit preserve content-based growth while fill supplies no fixed basis'() {
    const pass = new LayoutPass()
    for (const props of [{ basis: 'auto' }, { width: 'fit' }] satisfies ElementProps[]) {
      const result = pass.layout(new HStack({ width: px(300), children:
        [40, 80].map(size => leaf('width', size, { grow: 1, ...props })) }))
      assert.deepEqual(lengths(result), [130, 170])
    }
    const fitZero = pass.layout(new HStack({ width: px(300), children:
      [40, 80].map(size => leaf('width', size, { width: 'fit', basis: 0, grow: 1 })) }))
    assert.deepEqual(lengths(fitZero), [150, 150])
    for (const basis of [undefined, 'auto'] as const) {
      const row = pass.layout(new HStack({ width: px(300), children: [40, 80].map(size =>
        new TextFrame({ padding: 0, border_width: 0, grow: 1, basis, children: leaf('width', size) })) }))
      assert.deepEqual(lengths(row), basis === 'auto' ? [130, 170] : [150, 150])
    }
    const column = pass.layout(new VStack({ height: px(300), children:
      [40, 80].map(size => leaf('height', size, { grow: 1, basis: 'auto' })) }))
    assert.deepEqual(lengths(column, 'height'), [130, 170])
    // Fit width controls horizontal measurement, not a column's vertical basis.
    const vertical = pass.layout(new VStack({ height: px(300), children:
      [40, 80].map(size => leaf('height', size, { grow: 1, width: 'fit' })) }))
    assert.deepEqual(lengths(vertical, 'height'), [150, 150])
  },

  'omitted and zero growth retain ordinary sizing and shrinking still uses measured bases'() {
    const pass = new LayoutPass()
    for (const grow of [undefined, 0]) {
      const row = pass.layout(new HStack({ width: px(300), children:
        [40, 80].map(size => leaf('width', size, { grow })) }))
      assert.deepEqual(lengths(row), [40, 80])
    }
    for (const props of [{ shrink: 1 }, { basis: 'auto', grow: 1, shrink: 1 }] satisfies ElementProps[]) {
      const row = pass.layout(new HStack({ width: px(60), children:
        [40, 80].map(size => leaf('width', size, props)) }))
      assert.deepEqual(lengths(row), [20, 40])
    }
  },

  'default zero bases respect weights, gaps, and min/max limits'() {
    for (const Container of [HStack, VStack]) {
      const axis = Container === HStack ? 'width' : 'height'
      for (const [gap, props, expected] of [
        [0, {}, [100, 200, 100]],
        [20, {}, [90, 180, 90]],
        [0, { ['max_' + axis]: px(120) }, [140, 120, 140]],
        [0, { ['min_' + axis]: px(300) }, [50, 300, 50]],
      ] satisfies [number, ElementProps, number[]][]) {
        const result = new LayoutPass().layout(new Container({ [axis]: px(400), gap: px(gap), children: [
          leaf(axis, 40, { grow: 1 }), leaf(axis, 80, { grow: 2, ...props }), leaf(axis, 20, { grow: 1 }),
        ] }))
        assert.deepEqual(lengths(result, axis), expected)
      }
    }
    const minimum = new LayoutPass().layout(new HStack({ width: px(0), children:
      leaf('width', 40, { grow: 1, min_width: px(20) }) }))
    assert.deepEqual(lengths(minimum), [20])
    assert.equal(minimum.overflow.right, 40)
  },

  'maximum limits offer a finite budget while a minimum alone retains natural starting sizes'() {
    const children = [40, 80].map(size => leaf('width', size, { grow: 1 }))
    const pass = new LayoutPass()
    assert.deepEqual(lengths(pass.layout(new HStack({ max_width: px(300), children }))), [150, 150])
    assert.deepEqual(lengths(pass.layout(new HStack({ min_width: px(300), children }))), [130, 170])
    assert.deepEqual(lengths(pass.layout(new HStack({ width: 'fill', children }),
      make_request({ width: available(300) }))), [150, 150])
  },

  'nested document columns divide row width and reflow without an intrinsic width probe'() {
    const pass = new LayoutPass()
    const source = evaluate(`<TextCol gap={0}>
      <HStack gap={px(20)}>
        <TextFrame grow={1} padding={0} border-width={0}>
          <Text>A short paragraph.</Text>
        </TextFrame>
        <TextFrame grow={1} padding={0} border-width={0}>
          <Text>This longer paragraph wraps across several lines as the available column width changes.</Text>
        </TextFrame>
      </HStack>
    </TextCol>`)
    const wide = pass.layout(source, make_request({ width: exact(300) }))
    // Every source element is laid out once, directly at its allocated width.
    assert.deepEqual(pass.stats, { queries: 6, layouts: 6, hits: 0 })
    const narrow = pass.layout(source, make_request({ width: exact(160) }))
    assert.deepEqual(lengths(wide.children[0].fragment), [140, 140])
    assert.deepEqual(lengths(narrow.children[0].fragment), [70, 70])
    assert.ok(narrow.size.height > wide.size.height)
  },

  'auto basis is valid JSX metadata and invalid bases identify the child property'() {
    const row = new LayoutPass().layout(evaluate(`<HStack width={px(300)}>
      <Box width={px(40)} basis="auto" grow={1} />
      <Box width={px(80)} basis="auto" grow={1} />
    </HStack>`))
    assert.deepEqual(lengths(row), [130, 170])
    for (const basis of ['fit', 'fill', 'unknown', -1, NaN, Infinity]) {
      assert.throws(() => new LayoutPass().layout(new HStack({ children:
        new Box({ basis: basis as FlexSpec['basis'], grow: 1 }) })), /HStack\/Box\[0\]\.basis/)
    }
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} stack basis checks passed.`)
