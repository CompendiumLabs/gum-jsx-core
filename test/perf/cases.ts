import assert from 'node:assert/strict'
import {
  Box, Circle, Polyline, Edge, Element, Evaluator, Fonts, Grid, Group,
  HStack, LayoutPass, Network, Node, Plot, Points, Rect, Span, Text, VStack,
  exact, make_request, px, render_element, render_svg,
} from '../../src'
import type { BenchmarkSetup } from './runner'

function shapes(count: number) {
  return new Group({
    width: px(1000), height: px(600),
    children: Array.from({ length: count }, (_, i) => new Rect({
      width: px(12), height: px(8), pos: [((i * 37) % 980) / 1000, ((i * 53) % 580) / 600],
      fill: i % 2 ? '#3978b8' : '#d27038', stroke: 'none',
    })),
  })
}

function nested(depth = 5): Element {
  if (!depth) return new Circle({ width: px(8), height: px(8), fill: '#3978b8' })
  const Stack = depth % 2 ? HStack : VStack
  return new Box({
    padding: px(2),
    children: new Stack({ gap: px(2), children: Array.from({ length: 3 }, () => nested(depth - 1)) }),
  })
}

function paragraph() {
  return new Text({
    font_size: px(16),
    children: Array.from({ length: 40 }, (_, i) => [
      `Paragraph ${i}: vector graphics combine measured text with `,
      new Span({ font_weight: 700, children: 'styled spans' }),
      ' and predictable wrapping. ',
    ]).flat(),
  })
}

// Fixed data avoids random inputs and keeps sampling outside measured operations.
const line_points = Array.from({ length: 2000 }, (_, i) => [i / 100, Math.sin(i / 50)] as const)
const scatter_points = Array.from({ length: 2000 }, (_, i) => [i / 100, Math.sin(i * 17) + Math.cos(i * 7)] as const)
function plot(scatter: boolean) {
  return new Plot({
    width: px(800), height: px(450), font_size: px(14),
    title: 'Deterministic series', xlabel: 'Time', ylabel: 'Value', grid: true,
    children: scatter
      ? new Points({ points: scatter_points, point_size: px(3), fill: '#3978b8' })
      : new Polyline({ points: line_points, stroke: '#3978b8', stroke_width: px(2) }),
  })
}

function network() {
  const nodes = Array.from({ length: 64 }, (_, i) => new Node({
    id: `node-${i}`, pos: [i % 8, Math.floor(i / 8)], children: `N${i}`,
  }))
  const edges = nodes.flatMap((_, i) => [
    ...(i % 8 < 7 ? [new Edge({ start: `node-${i}`, end: `node-${i + 1}` })] : []),
    ...(i < 56 ? [new Edge({ start: `node-${i}`, end: `node-${i + 8}` })] : []),
  ])
  return new Network({
    width: px(1000), height: px(700), font_size: px(12),
    xlim: [-0.5, 7.5], ylim: [-0.5, 7.5], children: [...nodes, ...edges],
  })
}

const workloads: Record<string, () => Element> = {
  'shapes-100': () => shapes(100),
  'shapes-1000': () => shapes(1000),
  'nested-stacks-243-leaves': () => nested(),
  'wrap-stack-200': () => new HStack({
    width: px(600), gap: px(4), wrap: true,
    children: Array.from({ length: 200 }, (_, i) => new Box({
      width: px(20 + i % 7 * 10), height: px(12 + i % 3 * 4), grow: 1, max_width: px(100),
    })),
  }),
  'text-grid-100': () => new Grid({
    width: px(800), columns: 10, gap: px(4), font_size: px(14),
    children: Array.from({ length: 100 }, (_, i) => new Text({ children: `Cell ${i}: measured text` })),
  }),
  'styled-paragraph': () => new Box({ width: px(600), children: paragraph() }),
  'line-plot-2000': () => plot(false),
  'scatter-plot-2000': () => plot(true),
  'network-64-nodes-112-edges': network,
}

export const cases: Record<string, BenchmarkSetup> = {}

for (const [name, make] of Object.entries(workloads)) {
  cases[`core/construct/${name}`] = () => make
  cases[`core/layout/${name}`] = () => {
    const element = make(), fonts = new Fonts()
    // Warm font loading/Fontkit internals while keeping every measured pass fresh.
    render_element(element, { fonts })
    return () => new LayoutPass({ fonts: { value: fonts, version: fonts.version } }).layout(element)
  }
  cases[`core/svg/${name}`] = () => {
    const { fragment, svg } = render_element(make())
    assert.ok(svg.startsWith('<svg ') && fragment.size.width > 0 && fragment.size.height > 0)
    return () => render_svg(fragment)
  }
}

const jsx = `
<Grid columns={10} width={px(800)} gap={px(4)} font-size={px(14)}>
  {range(100).map(i => (
    <Box padding={px(4)} border-width={px(1)}>
      <Text>Cell {i}: measured text</Text>
    </Box>
  ))}
</Grid>
`

cases['core/evaluate/jsx-grid-100'] = () => {
  const evaluator = new Evaluator()
  assert.ok(evaluator.evaluate(jsx) instanceof Element)
  return () => evaluator.evaluate(jsx)
}
cases['core/render/jsx-grid-100'] = () => {
  const evaluator = new Evaluator(), fonts = new Fonts()
  render_element(evaluator.evaluate(jsx), { fonts })
  return () => render_element(evaluator.evaluate(jsx), { fonts })
}
cases['core/render/line-plot-2000'] = () => {
  const fonts = new Fonts()
  render_element(plot(false), { fonts })
  return () => render_element(plot(false), { fonts })
}
cases['core/cache/nested-stacks-hit'] = () => {
  const element = nested(), pass = new LayoutPass()
  const fragment = pass.layout(element)
  assert.equal(pass.layout(element), fragment)
  assert.ok(pass.stats.hits > 0)
  return () => pass.layout(element)
}
cases['core/layout/paragraph-resize-3-widths'] = () => {
  const element = paragraph(), fonts = new Fonts()
  const requests = [600, 400, 800].map(width => make_request({ width: exact(width) }))
  render_element(element, { fonts })
  return () => {
    // Bound cache lifetime; each operation measures real reflow at all three widths.
    const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })
    return requests.map(request => pass.layout(element, request))
  }
}
cases['core/fonts/new-provider-first-text-layout'] = () => {
  const element = new Text({ children: 'First render with a fresh font provider: AV office 0123456789.' })
  return () => new LayoutPass().layout(element)
}
