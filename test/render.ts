import assert from 'node:assert/strict'
import {
  Svg, Rect, Text, Fonts, LayoutPass, evaluate, make_viewport, layout_element, render_element,
  make_request, exact, px, THEMES,
} from '../src/index'
import type { Fragment } from '../src/index'

function nodes(fragment: Fragment): Fragment[] {
  return [fragment, ...fragment.children.flatMap(child => nodes(child.fragment))]
}
function strokes(fragment: Fragment): string[] {
  return [...new Set(nodes(fragment).flatMap(node => node.draw)
    .map(draw => draw.kind === 'image' || draw.kind === 'text' ? '' : draw.stroke).filter(Boolean))]
}

const tests: Record<string, () => void> = {
  'bare elements get a hugging viewport and existing viewports keep their descriptor'() {
    const pass = new LayoutPass()
    const rect = new Rect({ width: px(40), height: px(30) })
    const wrapped = make_viewport(rect)
    assert.ok(wrapped instanceof Svg)
    assert.equal(wrapped.props.children, rect)
    assert.deepEqual(pass.layout(wrapped).size, { width: 40, height: 30 })

    const custom = evaluate(`
      class CustomSvg extends Svg {
        static layout(props, query) {
          return Svg.layout({ ...props, background: props.surface }, query)
        }
      }
      return <CustomSvg surface="tomato"><Rect width={px(10)} height={px(10)} /></CustomSvg>
    `)
    const kept = make_viewport(custom, { defaults: { theme: 'dark' } })
    assert.equal(kept.type.name, 'CustomSvg')
    assert.equal(kept.type.layout, custom.type.layout)
    assert.equal((kept.props as { surface?: string }).surface, 'tomato')
    assert.equal(kept.props.theme, 'dark')
    assert.equal(pass.layout(kept).draw[0]?.fill, 'tomato')
  },

  'defaults sit under source props and overrides above them, ignoring undefined entries'() {
    const source = evaluate('<Svg theme="dark"><Rect width={px(10)} height={px(10)} /></Svg>')
    const bare = new Rect({ width: px(10), height: px(10) })
    const stroke = (result: ReturnType<typeof layout_element>) => {
      assert.equal(result.kind, 'fragment')
      return result.kind === 'fragment' ? strokes(result.fragment) : []
    }
    assert.deepEqual(stroke(layout_element(source, { defaults: { theme: 'light' } })), [THEMES.dark.foreground])
    assert.deepEqual(stroke(layout_element(bare, { defaults: { theme: 'dark' } })), [THEMES.dark.foreground])
    assert.deepEqual(stroke(layout_element(source, { overrides: { theme: 'light' } })), [THEMES.light.foreground])
    assert.deepEqual(stroke(layout_element(source, {
      defaults: { theme: 'light' }, overrides: { theme: undefined },
    })), [THEMES.dark.foreground])
    assert.deepEqual(stroke(layout_element(bare, { defaults: { theme: undefined } })), [THEMES.light.foreground])
  },

  'wrap props bound only the generated viewport'() {
    const bounds = { max_width: px(500), max_height: px(300) }
    const wide = new Rect({ width: px(2000), height: px(100) })
    const fitted = render_element(wide, { wrap: bounds })
    assert.deepEqual(fitted.size, { width: 500, height: 25 })
    assert.equal(fitted.fragment.overflow.right, 0.125)
    assert.deepEqual(fitted.fragment.children[0].transform, [0.25, 0, 0, 0.25, 0, 0])
    assert.deepEqual(render_element(new Rect(), { wrap: bounds }).size, { width: 500, height: 300 })
    assert.deepEqual(render_element(wide, { wrap: { max_width: undefined } }).size, { width: 2000, height: 100 })

    const explicit = evaluate('<Svg width={px(800)}><Rect /></Svg>')
    assert.equal(render_element(explicit, { wrap: bounds }).size.width, 800)
    assert.equal(make_viewport(explicit, { wrap: bounds }).props.max_width, undefined)
    assert.equal(render_element(explicit, { defaults: bounds }).size.width, 500)
  },

  'passes come from fonts or the core defaults and reused passes keep their cache'() {
    const rect = new Rect({ width: px(10), height: px(10) })
    const fresh = layout_element(rect)
    assert.ok(fresh.pass instanceof LayoutPass)
    assert.ok(fresh.pass.resource('fonts') instanceof Fonts)

    const fonts = new Fonts()
    const seeded = layout_element(rect, { fonts })
    assert.notEqual(seeded.pass, fresh.pass)
    assert.equal(seeded.pass.resource('fonts'), fonts)

    const reused = layout_element(rect, { pass: seeded.pass })
    assert.equal(reused.pass, seeded.pass)
    assert.ok(reused.pass.stats.hits > 0)
    assert.equal(reused.pass.resource('fonts'), fonts)

    const other = new Fonts()
    const replaced = render_element(rect, { pass: seeded.pass, fonts: other })
    assert.equal(replaced.pass, seeded.pass)
    assert.equal(seeded.pass.resource('fonts'), other)
    const hits = seeded.pass.stats.hits
    const bumped = render_element(rect, { pass: seeded.pass, fonts: other })
    assert.equal(bumped.pass, seeded.pass)
    assert.ok(seeded.pass.stats.hits > hits)
  },

  'requests reach the viewport and results carry markup, size, and fragment'() {
    const text = new Text({ children: 'Sized' })
    const result = render_element(text, {
      request: make_request({ width: exact(300), height: exact(120) }),
      title: 'Sized', background: 'white', id_prefix: 'sized',
    })
    assert.equal(result.kind, 'svg')
    assert.deepEqual(result.size, { width: 300, height: 120 })
    assert.equal(result.fragment.size, result.size)
    assert.match(result.svg, /^<svg [^>]*width="300" height="120"/)
    assert.ok(result.svg.includes('<title>Sized</title>'))
    assert.ok(result.svg.includes('<rect width="300" height="120" fill="white"/>'))

    const hugged = render_element(new Rect({ width: px(24), height: px(16) }))
    assert.deepEqual(hugged.size, { width: 24, height: 16 })
    assert.ok(hugged.svg.startsWith('<svg ') && hugged.svg.endsWith('</svg>'))
  },

  'plain values pass through both stages untouched'() {
    const value = evaluate('const x = 2\nreturn [x, x * 21]')
    assert.deepEqual(layout_element(value), { kind: 'value', value: [2, 42] })
    assert.deepEqual(render_element(value, { title: 'ignored' }), { kind: 'value', value: [2, 42] })
    const pass = new LayoutPass()
    for (const plain of [undefined, null, 'text', 7, { key: 'value' }]) {
      const result = render_element(plain, { pass })
      assert.equal(result.kind, 'value')
      assert.equal(result.kind === 'value' && result.value, plain)
    }
    assert.equal(pass.stats.layouts, 0)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} render checks passed.`)
