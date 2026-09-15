import assert from 'node:assert/strict'
import {
  Svg, Box, Frame, Text, Span, VStack, Rect, Dot, Points, ArrowHead, Fill,
  BarPlot, Slide, HMesh, LayoutPass, resolve_style, render_svg, evaluate, px, THEMES,
} from '../src/index'
import type { Fragment } from '../src/index'

function nodes(fragment: Fragment): Fragment[] {
  return [fragment, ...fragment.children.flatMap(child => nodes(child.fragment))]
}
function drawings(fragment: Fragment) {
  return nodes(fragment).flatMap(node => node.draw)
}
function named(fragment: Fragment, name: string): Fragment {
  const result = nodes(fragment).find(node => node.name === name)
  assert.ok(result, `Missing ${name}`)
  return result
}

const tests: Record<string, () => void> = {
  'root themes reach text, shapes, frames, and inline theme scopes'() {
    const fragment = new LayoutPass().layout(evaluate(`
      <Svg theme="dark">
        <Frame padding={px(8)}>
          <VStack>
            <Text>White <Span theme="light">black</Span> white</Text>
            <Rect />
            <Text color="tomato">Override</Text>
          </VStack>
        </Frame>
      </Svg>
    `))
    assert.equal(fragment.draw.length, 0)
    assert.equal(named(fragment, 'Border').draw[0]?.stroke, 'white')
    assert.equal(named(fragment, 'Rect').draw[0]?.stroke, 'white')
    const text = nodes(fragment).filter(node => node.name === 'Text')
    assert.deepEqual([...new Set(drawings(text[0]!).map(draw => draw.fill))], ['white', 'black'])
    assert.ok(drawings(text[1]!).every(draw => draw.fill === 'tomato'))
    assert.ok(!render_svg(fragment).includes('theme:'))
  },

  'shared descriptions and prepared text are cached separately for each theme'() {
    const child = new VStack({ children: [new Text({ children: 'Reusable' }), new HMesh()] })
    const pass = new LayoutPass()
    const dark = new Svg({ theme: 'dark', children: child })
    const light = new Svg({ theme: 'light', children: child })
    const a = pass.layout(dark), b = pass.layout(light)
    assert.notEqual(named(a, 'Text'), named(b, 'Text'))
    assert.equal(drawings(named(a, 'Text'))[0]?.fill, 'white')
    assert.equal(drawings(named(b, 'Text'))[0]?.fill, 'black')
    assert.equal(named(a, 'HMesh').draw[0]?.stroke, THEMES.dark.grid)
    assert.equal(named(b, 'HMesh').draw[0]?.stroke, THEMES.light.grid)
    assert.equal(pass.layout(dark), a)
    assert.equal(pass.layout(light), b)
    // Different palettes still matter when all inherited paints are explicit.
    const box = new Box({ background: 'theme:area', children: new Rect() })
    const style = { color: 'red', fill: 'none', stroke: 'blue' }
    const c = pass.layout(box, undefined, { style: resolve_style({ ...style, theme: 'dark' }) })
    const d = pass.layout(box, undefined, { style: resolve_style({ ...style, theme: 'light' }) })
    assert.equal(c.draw[0]?.fill, THEMES.dark.area)
    assert.equal(d.draw[0]?.fill, THEMES.light.area)
  },

  'nested theme scopes re-resolve semantic paints and retain explicit colors'() {
    const source = new VStack({ children: [new Rect(), new Dot()] })
    const pass = new LayoutPass()
    const fragment = pass.layout(new Svg({ theme: 'dark', color: 'red', stroke: 'navy',
      children: new Svg({ theme: 'light', children: new VStack({ children: [
        new Text({ children: 'Explicit ancestor color' }), source,
      ] }) }),
    }))
    assert.equal(drawings(named(fragment, 'Text'))[0]?.fill, 'red')
    assert.equal(named(fragment, 'Rect').draw[0]?.stroke, 'navy')
    assert.equal(named(fragment, 'Dot').draw[0]?.fill, 'black')
    const dark = resolve_style({ theme: 'dark', fill: 'theme:accent' })
    assert.equal(resolve_style({ theme: 'light' }, dark).fill, THEMES.light.accent)
    assert.equal(resolve_style({}, { ...dark, color: 'purple' }).color, 'purple')
  },

  'plot decorations and marks use their inherited palette without painting backgrounds'() {
    const pass = new LayoutPass()
    for (const theme of ['light', 'dark'] as const) {
      const colors = THEMES[theme]
      const fragment = pass.layout(new Svg({ theme, width: px(480), height: px(320),
        children: new Slide({ title: 'Results', children: new BarPlot({ values: [1, 3],
          border_width: px(1), title: 'Counts', legend: [{ label: 'Series' }],
        }) }),
      }))
      assert.equal(named(fragment, 'Slide').draw.length, 0)
      assert.equal(named(fragment, 'HMesh').draw[0]?.stroke, colors.grid)
      assert.equal(named(fragment, 'HAxis').draw[0]?.stroke, colors.muted)
      assert.equal(named(fragment, 'Bars').draw[0]?.fill, colors.accent)
      assert.equal(named(fragment, 'PlotBorder').draw[0]?.stroke, colors.border)
      assert.equal(named(fragment, 'Legend').draw.length, 0)
      assert.equal(named(named(fragment, 'Legend'), 'Border').draw[0]?.stroke, colors.border)
      assert.ok(nodes(named(fragment, 'BarPlot')).some(node => node.name === 'Text'
        && drawings(node).some(draw => draw.fill === colors.text)))
      for (const element of [new Dot(), new Points({ points: [[0, 0]] }), new ArrowHead()]) {
        const mark = pass.layout(new Svg({ theme, children: element }))
        assert.ok(nodes(mark).slice(1).flatMap(node => node.draw).some(draw => draw.fill === colors.foreground))
      }
      const area = pass.layout(new Svg({ theme, children: new Fill({ points: [[0, 0], [1, 1]] }) }))
      assert.equal(named(area, 'Fill').draw[0]?.fill, colors.area)
    }
  },

  'explicit component paints and transparent viewports override theme defaults'() {
    const pass = new LayoutPass()
    const fragment = pass.layout(new Svg({ theme: 'dark', background: 'none',
      children: new BarPlot({ width: px(300), height: px(200), values: [1, 2],
        color: 'red', stroke: 'green', fill: 'orange', grid_style: { stroke: 'purple' },
        border_width: px(1), border_color: 'pink', background: 'navy',
        legend: [{ label: 'Explicit', color: 'yellow' }],
        legend_style: { background: 'beige', border_color: 'brown' },
      }),
    }))
    assert.equal(fragment.draw.length, 0)
    assert.equal(named(fragment, 'Bars').draw[0]?.fill, 'orange')
    assert.equal(named(fragment, 'HAxis').draw[0]?.stroke, 'green')
    assert.equal(named(fragment, 'HMesh').draw[0]?.stroke, 'purple')
    assert.equal(named(fragment, 'PlotBorder').draw[0]?.stroke, 'pink')
    assert.equal(named(fragment, 'BarPlot').draw[0]?.fill, 'navy')
    assert.equal(named(fragment, 'Legend').draw[0]?.fill, 'beige')
    assert.equal(named(named(fragment, 'Legend'), 'Border').draw[0]?.stroke, 'brown')
    assert.equal(pass.layout(new Svg()).draw.length, 0)
    assert.equal(pass.layout(new Svg({ theme: 'dark', background: 'tomato' })).draw[0]?.fill, 'tomato')
    const plain = pass.layout(new Svg({ theme: 'dark', children: new Text({ children: 'Transparent' }) }))
    assert.equal(plain.draw.length, 0)
    assert.match(render_svg(plain, { background: 'navy' }), /<rect\b[^>]*fill="navy"/)
    assert.equal(plain.draw.length, 0)
  },

  'invalid themes and semantic colors fail with the element path'() {
    const pass = new LayoutPass()
    assert.throws(() => pass.layout(evaluate('<Svg theme="sepia" />')), /Svg: theme must be light or dark/)
    assert.throws(() => pass.layout(new Svg({ children: new Rect({ fill: 'theme:missing' }) })),
      /Svg\/Rect\[0\]: Unknown theme color/)
    assert.equal(pass.layout(new Svg({ theme: 'dark' })).draw.length, 0)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} theme checks passed.`)
