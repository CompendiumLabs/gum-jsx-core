import assert from 'node:assert/strict'
import {
  Box, Rect, LayoutPass, evaluate, render_svg, define_component, px,
  make_fragment, place_fragment, make_rect, draw_rect,
} from '../src/index'
import type { BoxProps, Fragment } from '../src/index'

function geometry({ debug, children, ...fragment }: Fragment): unknown {
  return { ...fragment, children: children.map(({ fragment, ...placement }) =>
    ({ ...placement, fragment: geometry(fragment) })) }
}

const tests: Record<string, () => void> = {
  'JSX debug marks only the selected element and leaves geometry and caches unchanged'() {
    const source = `
      <Svg>
        <Box debug width={px(100)} height={px(70)} padding={px(12)}>
          <HStack gap={px(6)}>
            <Rect width={px(30)} height={px(20)} />
            <Rect width={px(20)} height={px(20)} />
          </HStack>
        </Box>
      </Svg>
    `
    const element = evaluate(source), pass = new LayoutPass()
    const description = JSON.stringify(element)
    const result = pass.layout(element)
    const plain = pass.layout(evaluate(source.replace('<Box debug', '<Box')))
    const box = result.children[0].fragment
    assert.equal(result.debug, undefined)
    assert.equal(box.debug, true)
    assert.equal(box.children[0].fragment.debug, undefined)
    assert.deepEqual(box.content, { x: 12, y: 12, width: 76, height: 46 })
    assert.deepEqual(geometry(result), geometry(plain))

    const before = JSON.stringify(result), stats = pass.stats
    const svg = render_svg(result)
    assert.equal((svg.match(/data-gum-debug-box="allocated"/g) ?? []).length, 1)
    assert.equal((svg.match(/data-gum-debug-box="content"/g) ?? []).length, 1)
    assert.match(svg, /x="0" y="0" width="100" height="70" data-gum-debug-box="allocated"/)
    assert.match(svg, /x="12" y="12" width="76" height="46" data-gum-debug-box="content"/)
    assert.equal(JSON.stringify(element), description)
    assert.equal(JSON.stringify(result), before)
    assert.deepEqual(pass.stats, stats)
    assert.equal(pass.layout(element), result)
  },

  'debug supports defaults and components while an unmarked parent keeps child diagnostics'() {
    class DebugBox extends Box { static defaults: Partial<BoxProps> = { debug: true } }
    const Component = define_component<BoxProps>('Component', props => new Box(props))
    const pass = new LayoutPass()
    assert.equal(pass.layout(new DebugBox()).debug, true)
    assert.equal(pass.layout(new Component({ debug: true })).debug, true)

    const child = new Rect({ debug: true, width: px(20), height: px(10) })
    const result = pass.layout(new DebugBox({ debug: false, padding: px(4), children: child }))
    assert.equal(result.debug, undefined)
    assert.equal(result.children[0].fragment.debug, true)
    const svg = render_svg(result)
    assert.equal((svg.match(/data-gum-debug-box="allocated"/g) ?? []).length, 1)
    assert.doesNotMatch(svg, /data-gum-debug-box="content"/)

    const plain = render_svg(pass.layout(new Box()))
    assert.equal(render_svg(pass.layout(new DebugBox({ debug: false }))), plain)
    assert.doesNotMatch(plain, /data-gum-debug/)
  },

  'shared diagnostics follow nested placements above sibling paint and outside content clips'() {
    const selected = new LayoutPass().layout(new Box({
      debug: true, width: px(40), height: px(24), padding: px(3), background: 'white',
    }))
    const clipped = make_fragment({ size: { width: 50, height: 40 },
      children: [place_fragment(selected, [4, 5], [0, 1, -1, 0, 30, 0])],
      clip: make_rect(0, 0, 12, 12),
    })
    const cover = make_fragment({ size: { width: 160, height: 120 },
      draw: [draw_rect(make_rect(0, 0, 160, 120), { fill: 'black', stroke: 'none', stroke_width: 0 })],
    })
    const root = make_fragment({ size: cover.size, children: [
      place_fragment(clipped, [10, 8]),
      place_fragment(clipped, [70, 8], [2, 0, 0, 2, 0, 0]),
      place_fragment(cover),
    ] })
    const svg = render_svg(root)
    const start = svg.indexOf('<g data-gum-debug=""'), overlay = svg.slice(start)
    assert(start > svg.lastIndexOf('fill="black"'))
    assert.match(svg.slice(0, start), /clip-path="url\(#/)
    assert.doesNotMatch(overlay, /clip-path|opacity=/)
    assert.match(overlay, /transform="translate\(10 8\) translate\(4 5\) matrix\(0 1 -1 0 30 0\)"/)
    assert.match(overlay, /transform="translate\(70 8\) matrix\(2 0 0 2 0 0\) translate\(4 5\) matrix\(0 1 -1 0 30 0\)"/)
    assert.equal((overlay.match(/data-gum-debug-box="allocated"/g) ?? []).length, 2)
    assert.equal((overlay.match(/data-gum-debug-box="content"/g) ?? []).length, 2)
    assert.equal((overlay.match(/vector-effect="non-scaling-stroke"/g) ?? []).length, 4)
    assert.match(overlay, /pointer-events="none" aria-hidden="true"/)
    assert.match(overlay, /data-gum-debug-box="content"[^>]*stroke-dasharray="4 3"/)
    assert.match(svg, /viewBox="0 0 160 120" overflow="hidden"/)
  },

  'zero-sized allocations retain a diagnostic line or point'() {
    const pass = new LayoutPass()
    for (const [width, height] of [[0, 10], [10, 0], [0, 0]]) {
      const fragment = pass.layout(new Rect({ debug: true, width: px(width), height: px(height) }))
      assert.deepEqual(fragment.size, { width, height })
      const svg = render_svg(make_fragment({ size: { width: 30, height: 30 },
        children: [place_fragment(fragment, [10, 10])],
      }))
      assert(svg.includes(`<path d="M0 0l${width} ${height}" data-gum-debug-box="allocated"`))
      assert.match(svg, /stroke-linecap="round"/)
    }
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} debug checks passed.`)
