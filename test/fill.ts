import assert from 'node:assert/strict'
import {
  Box, Frame, TextBox, TextFrame, TextCol, Text, HStack, VStack,
  LayoutPass, evaluate, px, em, available, exact, make_request, resolve_sizing,
  prepare_request, define_element, finish_size, make_size, make_fragment,
} from '../src/index'
import type { ElementProps, SizeSpec } from '../src/index'
import { Fixed } from './fixtures/leaves'

const paragraph = 'A paragraph wraps at the allocated width while its font size stays fixed. '
  + 'The same document can fill a wide or narrow viewport.'
const widths = (fragment: ReturnType<LayoutPass['layout']>) =>
  fragment.children.map(child => child.fragment.size.width)

const tests: Record<string, () => void> = {
  'fill uses the actual offer and omission measures content, with natural fallback and exact precedence'() {
    const pass = new LayoutPass()
    for (const mode of ['fill', undefined] as const) {
      const box = new Box({ width: mode, max_width: px(120),
        children: new Fixed({ content_width: px(40) }) })
      const source = JSON.stringify(box)
      assert.equal(pass.layout(box).size.width, 40)
      for (const budget of [0, 80, 200]) {
        const request = make_request({ width: available(budget) })
        const result = pass.layout(box, request, { reference: { width: 500 } })
        assert.equal(result.size.width, mode === 'fill' ? Math.min(budget, 120) : 40)
        assert.equal(pass.layout(box, request, { reference: { width: 500 } }), result)
      }
      assert.equal(pass.layout(box, make_request({ width: exact(200) })).size.width, 200)
      assert.equal(JSON.stringify(box), source)
    }
    const request = make_request({ width: available(80) })
    const context = { reference: { width: 500 } }
    assert.equal(resolve_sizing({ width: 'fill' }, context, request).width.preferred, 80)
    assert.equal(resolve_sizing({ width: 1 }, context, request).width.preferred, 500)
    // An own maximum supplies a wrapping budget, not a width to occupy.
    const sizing = resolve_sizing({ width: 'fill', max_width: px(120) })
    const prepared = prepare_request(make_request(), sizing)
    assert.deepEqual(prepared.width, available(120))
    assert.deepEqual(prepare_request(prepared, sizing), prepared)
    assert.equal(pass.layout(new TextBox({ max_width: px(200), padding: 0, children: 'Hi' })).size.width,
      pass.layout(new Text({ text: 'Hi' })).size.width)
  },

  'box fill respects explicit widths, self alignment, local units, and limits inside padding and borders'() {
    const cases: [ElementProps, number][] = [
      [{}, 160], [{ width: 'fill' }, 160], [{ align_self: { x: 'start' } }, 40],
      [{ width: px(60) }, 60], [{ width: 0.5 }, 80], [{ width: 0 }, 0],
      [{ max_width: px(100) }, 100], [{ min_width: px(180) }, 180],
      [{ font_size: em(2), max_width: em(2) }, 64],
    ]
    for (const [props, expected] of cases) {
      const result = new LayoutPass().layout(new Frame({ width: px(202), height: px(100),
        padding: px(20), align: ['fill', 'end'],
        children: new Fixed({ content_width: px(40), content_height: px(20), ...props }) }))
      assert.equal(result.content!.width, 160)
      assert.equal(result.children[0].fragment.size.width, expected)
      assert.deepEqual(result.children[0].offset, { x: 21, y: 59 })
    }
    const pass = new LayoutPass()
    const child = new Fixed({ width: px(60), max_width: px(80) })
    const fill = pass.layout(new Box({ width: px(200), align: { x: 'fill' }, children: child }))
    const stretch = pass.layout(new Box({ width: px(200), align: { x: 'stretch' }, children: child }))
    assert.equal(fill.children[0].fragment.size.width, 60)
    assert.equal(stretch.children[0].fragment.size.width, 200)
    const zero = pass.layout(new Box({ width: px(0), align: 'fill', children: new Fixed() }))
    assert.equal(zero.children[0].fragment.size.width, 0)
    assert.equal(zero.overflow.right, 96)
  },

  'columns fill automatic widths and keep explicit, hugging, bounded, and aligned children'() {
    const column = new LayoutPass().layout(new VStack({ width: px(200), align: 'fill', children: [
      new Fixed(), new Fixed({ width: 'fill' }), new Fixed({ align_self: 'start' }),
      new Fixed({ width: px(60) }), new Fixed({ width: 0.5 }), new Fixed({ max_width: px(80) }),
      new Fixed({ min_width: px(220) }), new Fixed({ align_self: 'end' }),
      new Fixed({ width: px(20), max_width: px(30), align_self: 'stretch' }),
    ] }))
    assert.deepEqual(widths(column), [200, 200, 96, 60, 100, 80, 220, 96, 200])
    assert.equal(column.children[7].offset.x, 104)
    assert.equal(column.overflow.right, 20)
    const override = new LayoutPass().layout(new VStack({ width: px(200), children:
      new Fixed({ align_self: 'fill', max_width: px(150) }) }))
    assert.deepEqual(widths(override), [150])
  },

  'self alignment overrides one box axis without losing the other and selects the stack cross axis'() {
    const pass = new LayoutPass()
    const result = pass.layout(new Frame({ width: px(202), height: px(102), align: 'fill', children:
      new Fixed({ align_self: { x: 'end' }, content_width: px(40) }) }))
    assert.deepEqual(result.children[0].fragment.size, { width: 40, height: 100 })
    assert.deepEqual(result.children[0].offset, { x: 161, y: 1 })
    const tuple = pass.layout(new Box({ width: px(200), height: px(100), align: 'fill', children:
      new Fixed({ align_self: ['end', 'center'], content_width: px(40) }) }))
    assert.deepEqual(tuple.children[0].fragment.size, { width: 40, height: 20 })
    assert.deepEqual(tuple.children[0].offset, { x: 160, y: 40 })
    for (const Container of [HStack, VStack]) {
      const row = Container === HStack
      const f = pass.layout(new Container({ width: px(200), height: px(100), align: 'fill', children:
        new Fixed({ align_self: row ? { y: 'end' } : { x: 'end' }, content_width: px(40) }) }))
      assert.equal(f.children[0].offset[row ? 'y' : 'x'], row ? 80 : 160)
      const inherited = pass.layout(new Container({ width: px(200), height: px(100), align: 'fill', children:
        new Fixed({ align_self: row ? { x: 'end' } : { y: 'end' } }) }))
      assert.equal(inherited.children[0].fragment.size[row ? 'height' : 'width'], row ? 100 : 200)
    }
  },

  'natural fill columns select their width once and reflow within child limits'() {
    const pass = new LayoutPass()
    const text = new Text({ text: paragraph, max_width: px(80) })
    const expected = pass.layout(text)
    const column = pass.layout(new VStack({ align: 'fill', gap: px(4), children: [
      text, new Fixed({ width: px(200) }), new Fixed({ align_self: 'start', content_width: px(40) }),
    ] }))
    assert.equal(column.size.width, 200)
    assert.equal(column.children[0].fragment.size.width, 80)
    assert.equal(column.children[0].fragment.size.height, expected.size.height)
    assert.equal(column.children[2].fragment.size.width, 40)
    assert.equal(column.size.height, expected.size.height + 48)

    const references: unknown[] = []
    const Probe = define_element('Probe', (_, query) => {
      references.push(query.measure.reference)
      return make_fragment({ size: finish_size(make_size(40, 10), query.request, query.sizing) })
    })
    pass.layout(new VStack({ align: 'fill', children: [new Probe(), new Fixed({ width: px(200) })] }))
    assert.deepEqual(references, [{}, {}])
    assert.throws(() => pass.layout(new VStack({ align: 'fill', children:
      new Fixed({ width: 0.5 }) })), /definite fraction reference/)
  },

  'row fill follows reflowed text height and preserves explicit heights and cross-axis limits'() {
    const pass = new LayoutPass()
    const source = new HStack({ align: 'fill', children: [
      new Text({ text: paragraph, basis: 0, grow: 1 }),
      new Box({ width: px(10) }), new Box({ width: px(10), max_height: px(8) }),
      new Box({ width: px(10), height: px(5) }),
    ] })
    const wide = pass.layout(source, make_request({ width: exact(300) }))
    const narrow = pass.layout(source, make_request({ width: exact(160) }))
    for (const row of [wide, narrow]) {
      assert.equal(row.children[1].fragment.size.height, row.children[0].fragment.size.height)
      assert.equal(row.children[2].fragment.size.height, 8)
      assert.equal(row.children[3].fragment.size.height, 5)
      assert.deepEqual(widths(row), [row.size.width - 30, 10, 10, 10])
    }
    assert.ok(narrow.size.height > wide.size.height)
  },

  'one explicit document width carries through nested content and alignment selects compact children'() {
    const source = evaluate(`<Svg width={px(400)}>
      <TextBox width="fill" padding={px(20)}><TextCol gap={0}>
        <HStack><Text>Left</Text><Spacer /><Text>Right</Text></HStack>
        <Frame><Text>Content</Text></Frame>
        <TextFrame padding={px(10)}><TextCol gap={0}>
          <Box width={0.5} height={px(10)} />
          <Frame align-self="start"><Text>Small</Text></Frame>
        </TextCol></TextFrame>
      </TextCol></TextBox>
    </Svg>`)
    const pass = new LayoutPass(), svg = pass.layout(source)
    const panel = svg.children[0].fragment, column = panel.children[0].fragment
    assert.equal(panel.size.width, 400)
    assert.equal(column.size.width, 360)
    assert.deepEqual(widths(column), [360, 360, 360])
    const inner = column.children[2].fragment.children[0].fragment
    assert.equal(inner.size.width, 338)
    assert.equal(inner.children[0].fragment.size.width, 169)
    assert.ok(inner.children[1].fragment.size.width < 338)

    for (const Container of [TextBox, TextFrame, TextCol]) {
      const child = new Fixed({ content_width: px(40) })
      const natural = pass.layout(new Container({ children: child }))
      const offered = pass.layout(new Container({ children: child }),
        make_request({ width: available(300) }))
      assert.deepEqual(offered.size, natural.size)
      const filled = pass.layout(new Container({ width: 'fill', children: child }), make_request({ width: available(300) }))
      assert.equal(filled.size.width, 300)
    }
    const centered = pass.layout(new TextBox({ width: px(200), padding: 0, align: 'center',
      children: new Fixed({ content_width: px(40) }) }))
    assert.equal(centered.children[0].offset.x, 80)
    const primitives = pass.layout(new Box({ children: new VStack({ children: new Fixed() }) }),
      make_request({ width: available(300) }))
    assert.equal(primitives.size.width, 96)
  },

  'fill width adds no implicit flex weights and hugging text still wraps'() {
    const pass = new LayoutPass()
    const row = pass.layout(new HStack({ width: px(300), children: [
      new TextBox({ padding: 0, children: new Fixed({ content_width: px(40) }) }),
      new TextBox({ padding: 0, children: new Fixed({ content_width: px(60) }) }),
    ] }))
    assert.deepEqual(widths(row), [40, 60])
    const text = new TextBox({ padding: 0, children: paragraph })
    const wide = pass.layout(text, make_request({ width: available(300) }))
    const narrow = pass.layout(text, make_request({ width: available(120) }))
    assert.ok(narrow.size.height > wide.size.height)
    assert.ok(narrow.size.width <= 120)
    const limited = pass.layout(new TextCol({ max_width: px(120), children: paragraph }))
    assert.ok(limited.size.width <= 120)
    assert.ok(limited.size.height > wide.size.height)
  },

  'document panels preserve a sole block child through fragments and keep inline text intact'() {
    const child = new TextCol({ children: 'Nested' })
    for (const Container of [TextBox, TextFrame]) {
      const panel = new Container({ children: [null, false, ' ', [[child]], '\n'] })
      assert.equal(panel.props.children, child)
    }
    const panel = evaluate(`<TextBox><>{false}{true && <TextCol>Nested</TextCol>}</></TextBox>`)
    assert.equal(new LayoutPass().layout(panel).children[0].fragment.name, 'TextCol')
    const inline = evaluate('<TextFrame>Before <Span font-weight={700}>bold</Span> after</TextFrame>')
    const text = new LayoutPass().layout(inline).children[0].fragment
    assert.equal(text.label, 'Before bold after')
    assert.throws(() => evaluate('<TextBox><Box /><Box /></TextBox>'), /one content element/)
    const mixed = evaluate('<TextBox>Text<Box width={px(12)} height={px(8)} /></TextBox>')
    const paragraph = new LayoutPass().layout(mixed).children[0].fragment
    assert.equal(paragraph.name, 'Text')
    assert.ok(paragraph.children[0].fragment.children.some(child => child.fragment.name === 'Box'))
  },

  'fill is sizing alignment, not a point or main-axis packing value'() {
    for (const source of [
      '<HStack justify="fill" />', '<Text fit fit-align="fill">A</Text>',
      '<Rotate origin="fill"><Text>A</Text></Rotate>',
      '<Group width={px(100)} height={px(100)}><Text anchor="fill">A</Text></Group>',
      '<Graph><Text anchor="fill">A</Text></Graph>',
      '<Overlay><Text>A</Text><Text anchor="fill">B</Text></Overlay>',
    ]) assert.throws(() => new LayoutPass().layout(evaluate(source)), /grow|point|never stretches/)
    for (const width of ['unknown', 'auto', '100%']) {
      assert.throws(() => new LayoutPass().layout(new Box({ width } as unknown as SizeSpec)), /Box.width/)
    }
    for (const prop of ['min_width', 'max_width', 'min_height', 'max_height']) {
      assert.throws(() => new LayoutPass().layout(new Box({ [prop]: 'fill' })), /expected a length/)
    }
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} fill sizing and document checks passed.`)
