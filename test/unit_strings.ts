import assert from 'node:assert/strict'
import {
  Box, CoordLine, Graph, LayoutPass, Rect, Svg, UnresolvedLengthError,
  available, em, evaluate, make_measure, make_request, measure_length, normalize_length,
  prepare_request, px, render_element, render_svg, resolve_font_size, resolve_insets, resolve_length,
  resolve_line_height, resolve_sizing,
} from '../src'
import type { Length, LengthString, NormalizedLength } from '../src'

const tests: Record<string, () => void> = {
  'unit strings normalize to the same immutable lengths as helpers and numeric fractions'() {
    const cases: [LengthString, Length][] = [
      ['24px', px(24)], ['1.5em', em(1.5)],
      ['50%', 0.5], ['-12.5%', -0.125], ['+.5em', em(0.5)], ['1e2px', px(100)], ['0', px(0)],
    ]
    for (const [source, expected] of cases) {
      const normalized = normalize_length(source)
      assert.deepEqual(normalized, normalize_length(expected))
      assert.ok(Object.isFrozen(normalized))
      assert.deepEqual(normalize_length(normalized), normalized)
    }
    assert.deepEqual(normalize_length(' \t-1.25e+2px\n' as LengthString), { value: -125, unit: 'px' })
  },

  'string units resolve against font and explicit percentage references'() {
    const measure = make_measure({ font_size: 20,
      reference: { width: 200, height: 100 }, path: 'Card' })
    assert.equal(resolve_length('24px', measure), 24)
    assert.equal(resolve_length('1.5em', measure), 30)
    assert.equal(resolve_length('50%', measure, measure.reference.width), 100)
    assert.equal(resolve_length('-50%', measure, measure.reference.height), -50)
    assert.equal(resolve_font_size('150%', measure), 30)
    assert.equal(resolve_line_height('125%', measure), 25)
    assert.equal(resolve_length('50%', measure, 0), 0)
    for (const zero of ['0', '0px', '0em', '0%'] as const) {
      assert.equal(resolve_length(zero), 0)
    }
    assert.deepEqual(measure_length('50%'), { value: 0.5, unit: 'fraction' })
    assert.throws(() => resolve_length('50%', measure, undefined, 'gap'), error => {
      assert.ok(error instanceof UnresolvedLengthError)
      assert.equal(error.path, 'Card.gap')
      return true
    })
  },

  'malformed strings fail at the source property without accepting partial numbers or unsupported units'() {
    const measure = make_measure({ path: 'Card' })
    for (const value of ['', '12', '4rem', '1 em', '2pxjunk', 'calc(2px + 2px)', 'NaNpx',
      'Infinitypx', '0x10px', '1.2.3em', '1.px', '--2px', 'fill', 'auto', '1PX']) {
      assert.throws(() => resolve_length(value as Length, measure, 100, 'gap'), /Card.gap.*expected a length/)
    }
    assert.throws(() => resolve_length('1e309px' as Length, measure, undefined, 'gap'), /Card.gap.*finite/)
    for (const [props, property] of [
      [{ width: '3rem' }, 'width'], [{ padding: '1 em' }, 'padding.left'],
      [{ stroke_width: '2pt' }, 'stroke_width'], [{ stroke_dasharray: ['2px', 'bad'] }, 'stroke_dasharray[1]'],
    ] as const) {
      assert.throws(() => new LayoutPass().layout(new Box(props as never)), error => {
        assert.ok(error instanceof Error)
        assert.ok(error.message.includes(`Box.${property}: expected a length`), error.message)
        return true
      })
    }
  },

  'padding shorthands choose each percentage axis and accept mixed representations'() {
    const measure = make_measure({ font_size: 20, reference: { width: 200, height: 100 } })
    assert.deepEqual(resolve_insets('10%', measure), { left: 20, right: 20, top: 10, bottom: 10 })
    assert.deepEqual(resolve_insets(['1em', '6px'], measure), { left: 20, right: 20, top: 6, bottom: 6 })
    assert.deepEqual(resolve_insets(['10%', px(2), '1em', 0], measure), { left: 20, right: 0, top: 10, bottom: 2 })
    assert.deepEqual(resolve_insets({ h: '10%', v: '6px', left: '2px' }, measure),
      { left: 2, right: 20, top: 6, bottom: 6 })
  },

  'quoted JSX lengths render identically across root fonts, flex layout, rounded corners, and paint'() {
    const strings = evaluate(`
      <Svg width="800px" height="600px" font-size="24px">
        <Box width="50%" padding={["1em", "12px"]} border-width="0.25em" border-radius={{ t: "0.5em", b: "8px" }}>
          <HStack width="100%" gap="8px">
            <Rect basis="35%" height="60px" border-radius="1em" stroke-width="3px" stroke-dasharray={["8px", "0.5em"]} />
            <Text font-size="150%" line-height="120%">
              Hello <Span font-size="0.5em">world</Span>
            </Text>
          </HStack>
        </Box>
      </Svg>
    `)
    const helpers = evaluate(`
      <Svg width={px(800)} height={px(600)} font-size={px(24)}>
        <Box width={0.5} padding={[em(1), px(12)]} border-width={em(0.25)} border-radius={{ t: em(0.5), b: px(8) }}>
          <HStack width={1} gap={px(8)}>
            <Rect basis={0.35} height={px(60)} border-radius={em(1)} stroke-width={px(3)} stroke-dasharray={[px(8), em(0.5)]} />
            <Text font-size={1.5} line-height={1.2}>
              Hello <Span font-size={em(0.5)}>world</Span>
            </Text>
          </HStack>
        </Box>
      </Svg>
    `)
    const pass = new LayoutPass()
    assert.equal(render_svg(pass.layout(strings)), render_svg(pass.layout(helpers)))
  },

  'maximum-only roots accept string lengths and keep fill distinct from lengths'() {
    const actual = new Svg({ max_width: '320px', max_height: '200px', font_size: '24px',
      children: new Box({ padding: '1em', children: new Rect({ width: '4em', height: '2em' }) }) })
    const expected = new Svg({ max_width: px(320), max_height: px(200), font_size: px(24),
      children: new Box({ padding: em(1), children: new Rect({ width: em(4), height: em(2) }) }) })
    assert.equal(render_element(actual).svg, render_element(expected).svg)
    const request = make_request({ width: available(300) })
    const sizing = resolve_sizing({ width: 'fill', min_width: '10px', max_width: '50%' },
      { reference: { width: 400 } }, request)
    assert.deepEqual(prepare_request(request, sizing).width, { kind: 'exact', value: 200 })
    assert.throws(() => new LayoutPass().layout(new Svg({ width: '2em' })), /requires pixels/)
    assert.equal(new LayoutPass().layout(new Svg({ width: '0', height: '0' })).size.width, 0)
  },

  'graph numbers retain data mapping while strings resolve in local length coordinates'() {
    const source = new Graph({ width: '200px', height: '100px', xlim: [0, 10], ylim: [0, 10],
      children: new CoordLine({ points: [[2, 2], ['20%', '20%'], ['10px', '2em'], ['40%', '30%']] }) })
    const fragment = new LayoutPass().layout(source)
    const draw = fragment.children[0].fragment.draw[0]
    assert.equal(draw.kind, 'path')
    if (draw.kind === 'path') assert.deepEqual(draw.commands, [
      { kind: 'M', x: 40, y: 80 }, { kind: 'L', x: 40, y: 20 },
      { kind: 'L', x: 10, y: 32 }, { kind: 'L', x: 80, y: 30 },
    ])
  },

}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} unit string checks passed.`)

if (false) {
  const length: LengthString = '1.5em'
  new Box({ padding: [length, '5%'], width: 'fill' })
  new Svg({ width: '800px', height: '600px', font_size: '24px' })
  // @ts-expect-error Nonzero unitless strings have no implied unit.
  const missing: Length = '12'
  // @ts-expect-error Unsupported units are rejected for host callers too.
  const unknown: Length = '2rem'
  // @ts-expect-error Normalized lengths keep the canonical unit representation.
  const normalized: NormalizedLength = '12px'
}
