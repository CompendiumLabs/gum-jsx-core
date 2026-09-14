import assert from 'node:assert/strict'
import {
  Box, Frame, Rect, RoundedRect, Square, Bars, VBars, HBars, Bar, VBar, HBar, Graph, BarPlot,
  LayoutPass, px, em, make_request, exact, make_rect, make_clip, make_fragment,
  draw_rect, render_svg, evaluate,
} from '../src/index'
import type { CornerRadii, RectRadius, RadiusSides, RectDraw, Fragment } from '../src/index'

const fixed = make_request({ width: exact(200), height: exact(100) })
const zero = { x: 0, y: 0 }
const paint = { fill: 'blue', stroke: 'none', stroke_width: 0 }
const pass = new LayoutPass()
const corners = (values: Partial<CornerRadii>): CornerRadii => ({ tl: zero, tr: zero, bl: zero, br: zero, ...values })
const radius_of = (fragment: Fragment) => (fragment.draw[0] as RectDraw).radius

const tests: Record<string, () => void> = {
  'radius side and corner shorthands round only their selected corners'() {
    const selections = { t: ['tl', 'tr'], b: ['bl', 'br'], l: ['tl', 'bl'], r: ['tr', 'br'],
      tl: ['tl'], tr: ['tr'], bl: ['bl'], br: ['br'] } as const
    for (const [key, selected] of Object.entries(selections)) {
      const radius = { [key]: px(8) }
      const expected = corners(Object.fromEntries(selected.map(corner => [corner, { x: 8, y: 8 }])))
      const props = { radius, background: 'blue' }
      for (const Shape of [Rect, RoundedRect, Square, Box, Frame]) {
        const fragment = pass.layout(new Shape(props), fixed)
        assert.deepEqual(radius_of(fragment), expected, `${Shape.name}.${key}`)
      }
    }
  },

  'radius corner overrides and side precedence are independent of object order'() {
    const entries = { l: px(3), r: px(4), t: [px(10), px(5)], b: em(0.5), tl: 0, br: [0.1, 0.2] } satisfies RadiusSides
    const reversed = Object.fromEntries(Object.entries(entries).reverse()) as RadiusSides
    for (const radius of [entries, reversed]) {
      assert.deepEqual(radius_of(pass.layout(new Rect({ radius, font_size: px(10) }), fixed)),
        { tl: zero, tr: { x: 10, y: 5 }, bl: { x: 5, y: 5 }, br: { x: 20, y: 20 } })
    }
    assert.deepEqual(radius_of(pass.layout(new Rect({ radius: {} }), fixed)), corners({}))
  },

  'scalar and pair radii keep their units and uniform SVG rectangles'() {
    const inputs: [RectRadius, { x: number; y: number }][] = [
      [0.1, { x: 10, y: 10 }], [px(8), { x: 8, y: 8 }], [em(0.5), { x: 5, y: 5 }],
      [[0.1, em(0.5)], { x: 20, y: 5 }], [{ x: 0.1, y: em(0.5) }, { x: 20, y: 5 }],
    ]
    for (const [radius, expected] of inputs) {
      for (const Shape of [Rect, Box, Frame]) {
        const fragment = pass.layout(new Shape({ radius, background: 'blue', font_size: px(10) }), fixed)
        assert.deepEqual(radius_of(fragment), expected)
        assert.match(render_svg(fragment), new RegExp(`rx="${expected.x}" ry="${expected.y}"`))
        assert.doesNotMatch(render_svg(fragment), /<path/)
      }
    }
    assert.deepEqual(radius_of(pass.layout(new Rect({ radius: { tl: 0.1, tr: [0.1, em(0.5)] },
      font_size: px(10) }), fixed)), corners({ tl: { x: 10, y: 10 }, tr: { x: 20, y: 5 } }))
  },

  'per-corner backgrounds, inside borders, and content clips share their outlines'() {
    const fragment = pass.layout(new Frame({ width: px(100), height: px(60), radius: { t: [px(20), px(10)] },
      border_width: px(2), background: 'white', clip: true,
      children: new Rect({ width: px(200), height: px(100), fill: 'red', stroke: 'none' }) }))
    const expected = corners({ tl: { x: 20, y: 10 }, tr: { x: 20, y: 10 } })
    assert.deepEqual(radius_of(fragment), expected)
    const border = fragment.children.at(-1)!.fragment
    assert.deepEqual(radius_of(border), expected)
    assert.deepEqual(border.clip!.radius, expected)
    assert.deepEqual(fragment.children[0].fragment.clip, { x: 2, y: 2, width: 96, height: 56,
      radius: corners({ tl: { x: 18, y: 8 }, tr: { x: 18, y: 8 } }) })
    assert.deepEqual(fragment.ink, { x: 0, y: 0, width: 100, height: 60 })
    assert.ok(fragment.overflow.right > 0)
    const svg = render_svg(fragment)
    const outer = 'M20 0L80 0A20 10 0 0 1 100 10L100 60L100 60L0 60L0 60L0 10A20 10 0 0 1 20 0Z'
    const inner = 'M20 2L80 2A18 8 0 0 1 98 10L98 58L98 58L2 58L2 58L2 10A18 8 0 0 1 20 2Z'
    assert.equal(svg.split(`d="${outer}"`).length - 1, 3)
    assert.ok(svg.includes(`d="${inner}"`))
    assert.match(svg, /<clipPath[^>]*><path/)
  },

  'corner radii clamp, copy, and freeze at drawing and clipping boundaries'() {
    const tl = { x: 100, y: 100 }, radius = { tl, tr: [4, 3] as [number, number], br: zero, bl: zero }
    const rect = make_rect(2, 3, 20, 10)
    const draw = draw_rect(rect, paint, radius), clip = make_clip(rect, radius)
    const expected = corners({ tl: { x: 10, y: 5 }, tr: { x: 4, y: 3 } })
    tl.x = 0; radius.tr[0] = 0
    assert.deepEqual(draw.radius, expected)
    assert.deepEqual(clip.radius, expected)
    assert.ok(Object.isFrozen(draw.radius))
    assert.ok(Object.isFrozen((draw.radius as CornerRadii).tl))
    const fragment = make_fragment({ size: { width: 24, height: 16 }, draw: [draw], clip })
    assert.deepEqual(radius_of(fragment), expected)
    assert.deepEqual(fragment.clip!.radius, expected)
    for (const [width, height] of [[0, 10], [20, 0], [0, 0]]) {
      const empty = make_fragment({ size: { width, height }, draw: [draw_rect(make_rect(0, 0, width, height),
        { ...paint, stroke: 'black', stroke_width: 2 }, expected)] })
      assert.equal(empty.ink, null)
      assert.doesNotMatch(render_svg(empty), /<path|NaN|Infinity/)
    }
    const thick = pass.layout(new Frame({ radius: { t: px(100) }, border_width: px(100), clip: true,
      children: new Rect() }), fixed)
    assert.deepEqual(thick.children[0].fragment.clip!.radius, corners({}))
    assert.doesNotMatch(render_svg(thick), /NaN|Infinity/)
  },

  'elliptical corners with a zero axis stay square and lower corners use clockwise arcs'() {
    const fragment = pass.layout(new Rect({ radius: { tl: [px(10), 0], tr: [0, px(10)],
      bl: [px(3), px(4)], br: px(5) } }), fixed)
    assert.ok(render_svg(fragment).includes('d="M0 0L200 0L200 0L200 95A5 5 0 0 1 195 100'
      + 'L3 100A3 4 0 0 1 0 96L0 0L0 0Z"'))
  },

  'bars and BarPlot accept corner radii in screen coordinates while retaining scalar sizing'() {
    for (const Mark of [Bars, VBars, HBars, Bar, VBar, HBar]) {
      const bars = new Mark({ values: [1, -1, 0], positions: [1, 2, 3], value: 1, position: 1, radius: { t: px(8) } })
      const fragment = pass.layout(new Graph({ children: bars }), fixed).children[0].fragment
      for (const draw of fragment.draw as readonly RectDraw[]) {
        const r = { x: Math.min(8, draw.rect.width / 2), y: Math.min(8, draw.rect.height / 2) }
        assert.deepEqual(draw.radius, corners({ tl: r, tr: r }), Mark.name)
      }
    }
    for (const radius of [0.1, [0.05, 0.1], { t: 0.1 }] satisfies RectRadius[]) {
      const fragment = pass.layout(new Graph({ xlim: [0, 2], ylim: [0, 2],
        children: new Bars({ values: [1], positions: [1], radius }) }), fixed).children[0].fragment
      const r = { x: 10, y: 10 }
      assert.deepEqual(radius_of(fragment), typeof radius === 'object' && 't' in radius ? corners({ tl: r, tr: r }) : r)
    }
    const source = evaluate('<Svg width={px(200)} height={px(100)}><BarPlot values={[1, 2]} radius={{t: px(4)}} /></Svg>')
    assert.match(render_svg(pass.layout(source)), /A4 4 0 0 1/)
  },

  'value-dependent bar styles round the exposed ends and preserve callback indices on resize'() {
    for (const direction of ['vertical', 'horizontal'] as const) {
      const calls: [number, number][] = []
      const source = new BarPlot({ values: [1, NaN, -2], direction,
        styles: (value, index) => {
          calls.push([value, index])
          const side = direction === 'vertical' ? value > 0 ? 't' : 'b' : value > 0 ? 'r' : 'l'
          return { fill: value > 0 ? 'blue' : 'red', radius: { [side]: px(4 + index) } }
        },
      })
      const before = JSON.stringify(source), layout = new LayoutPass()
      assert.deepEqual(calls, [[1, 0], [-2, 2]])
      for (const width of [400, 600]) {
        const root = layout.layout(source, make_request({ width: exact(width), height: exact(300) }))
        const collect = (node: Fragment): RectDraw[] => node.name === 'Bars'
          ? [...node.draw] as RectDraw[] : node.children.flatMap(child => collect(child.fragment))
        const [positive, negative] = collect(root), small = { x: 4, y: 4 }, large = { x: 6, y: 6 }
        assert.deepEqual(positive.radius, corners(direction === 'vertical' ? { tl: small, tr: small } : { tr: small, br: small }))
        assert.deepEqual(negative.radius, corners(direction === 'vertical' ? { bl: large, br: large } : { tl: large, bl: large }))
        assert.equal(positive.fill, 'blue'); assert.equal(negative.fill, 'red')
        assert.match(render_svg(root), /A4 4 0 0 1/)
        assert.match(render_svg(root), /A6 6 0 0 1/)
      }
      assert.deepEqual(calls, [[1, 0], [-2, 2]])
      assert.equal(JSON.stringify(source), before)
    }
  },

  'per-bar radius overrides preserve shared defaults, explicit zero, and source snapshots'() {
    const custom = { t: px(6) }
    const styles = [{ radius: custom }, { radius: 0 }, { fill: 'red' }, { radius: undefined }]
    const bars = new Bars({ values: [1, 2, 3, 4], radius: px(8), styles })
    custom.t = px(30)
    const root = pass.layout(new Graph({ children: bars }), make_request({ width: exact(600), height: exact(300) }))
    const draw = root.children[0].fragment.draw as readonly RectDraw[]
    assert.deepEqual(draw.map(item => item.radius), [
      corners({ tl: { x: 6, y: 6 }, tr: { x: 6, y: 6 } }), zero, { x: 8, y: 8 }, { x: 8, y: 8 },
    ])
    assert.equal(draw[2].fill, 'red')
  },

  'per-bar radii resolve layout units and clamp to each bar rectangle'() {
    const bars = new Bars({ values: [1, 1, 1], positions: [0, 1, 2],
      styles: [{ radius: em(0.5), font_size: px(20) }, { radius: [0.05, 0.1] }, { radius: px(1000) }],
    })
    const fragment = pass.layout(new Graph({ xlim: [-1, 3], ylim: [0, 2], children: bars }), fixed).children[0].fragment
    const draw = fragment.draw as readonly RectDraw[]
    assert.deepEqual(draw[0].radius, { x: 10, y: 10 })
    assert.deepEqual(draw[1].radius, { x: 10, y: 10 })
    assert.deepEqual(draw[2].radius, { x: draw[2].rect.width / 2, y: draw[2].rect.height / 2 })
    const invalid = new Bars({ values: [1], styles: () => ({ radius: { t: px(-1) } }) })
    assert.throws(() => pass.layout(new Graph({ children: invalid }), fixed), /radius.*nonnegative/)
  },

  'invalid corner lengths, unknown keys, and malformed pairs fail clearly'() {
    for (const radius of [{ t: px(-1) }, { br: -0.1 }, { l: [px(2), px(-1)] },
      { tl: NaN }, { t: [1] }, { b: { x: 1 } }, { top: px(2) }, [1], [1, 2, 3]]) {
      assert.throws(() => pass.layout(new Frame({ radius: radius as RectRadius }), fixed),
        /radius.*(?:nonnegative|finite|exactly two|unknown)/)
    }
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} radius checks passed.`)
