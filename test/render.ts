import assert from 'node:assert/strict'
import {
  Page, Document, Rect, Text, Fonts, LayoutPass, evaluate, make_viewport, layout_document, layout_element, render_element,
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
    assert.ok(wrapped instanceof Page)
    assert.equal(wrapped.props.children, rect)
    assert.deepEqual(pass.layout(wrapped).size, { width: 40, height: 30 })

    const custom = evaluate(`
      class CustomPage extends Page {
        static layout(props, query) {
          return Page.layout({ ...props, background: props.surface }, query)
        }
      }
      return <CustomPage surface="tomato"><Rect width={px(10)} height={px(10)} /></CustomPage>
    `)
    const kept = make_viewport(custom, { defaults: { theme: 'dark' } })
    assert.equal(kept.type.name, 'CustomPage')
    assert.equal(kept.type.layout, custom.type.layout)
    assert.equal((kept.props as { surface?: string }).surface, 'tomato')
    assert.equal(kept.props.theme, 'dark')
    assert.equal(pass.layout(kept).draw[0]?.fill, 'tomato')
  },

  'defaults sit under source props and overrides above them, ignoring undefined entries'() {
    const source = evaluate('<Page theme="dark"><Rect width={px(10)} height={px(10)} /></Page>')
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

    const explicit = evaluate('<Page width={px(800)}><Rect /></Page>')
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

  'documents snapshot page order and defaults without laying out content'() {
    const page = new Page({ children: new Rect({ width: px(20), height: px(10) }) })
    const children = [page]
    const width = { value: 80, unit: 'px' } as const
    const document = new Document({ children, width, title: 'Pages' })
    children.push(new Page())
    assert.deepEqual(document.pages, [page])
    assert.equal(document.pages[0], page)
    assert.notEqual(document.defaults.width, width)
    assert.equal(page.props.width, undefined)
    assert.equal(document.title, 'Pages')
    assert.throws(() => new Document(), /at least one Page/)
    assert.throws(() => new Document({ children: new Rect() }), /must be Page/)
    assert.throws(() => new Document({ children: page, title: 42 as never }), /title must be a string/)
    const source = evaluate(`<Document>
      <><Page width="20px" height="10px" />{false}{null}</>
      {[<Page width="40px" height="30px" />]}
    </Document>`)
    assert.ok(source instanceof Document)
    assert.deepEqual(layout_document(source).pages.map(page => page.size), [
      { width: 20, height: 10 }, { width: 40, height: 30 },
    ])
  },

  'document pages lay out independently with source and host precedence'() {
    const document = new Document({ width: px(100), theme: 'dark', background: 'red', children: [
      new Page({ width: undefined, theme: undefined, children: new Rect({ height: px(20) }) }),
      new Page({ width: px(200), theme: 'light', background: 'blue',
        children: new Rect({ height: px(40) }) }),
    ] })
    const result = layout_element(document, { defaults: { width: px(300), theme: 'light' } })
    assert.equal(result.kind, 'document')
    assert.deepEqual(result.pages.map(page => page.size), [
      { width: 100, height: 20 }, { width: 200, height: 40 },
    ])
    assert.deepEqual(result.pages.map(page => page.draw[0]?.fill), ['red', 'blue'])
    assert.ok(strokes(result.pages[0]).includes(THEMES.dark.foreground))
    assert.ok(strokes(result.pages[1]).includes(THEMES.light.foreground))
    const overridden = layout_document(document, { pass: result.pass,
      overrides: { width: px(50), theme: 'light', background: undefined } })
    assert.equal(overridden.pass, result.pass)
    assert.deepEqual(overridden.pages.map(page => page.size), [
      { width: 50, height: 20 }, { width: 50, height: 40 },
    ])
    assert.deepEqual(overridden.pages.map(page => page.draw[0]?.fill), ['red', 'blue'])
    for (const page of overridden.pages) assert.ok(strokes(page).includes(THEMES.light.foreground))
    const exact_pages = layout_document(document, { request: make_request({ width: exact(60), height: exact(30) }) })
    for (const page of exact_pages.pages) assert.deepEqual(page.size, { width: 60, height: 30 })
  },

  'document SVG pages share resources and keep distinct definition IDs'() {
    const document = new Document({ title: 'A & B', children: [
      new Page({ children: new Text({ children: 'First' }) }),
      new Page({ children: new Text({ children: 'Second' }) }),
    ] })
    const fonts = new Fonts()
    const result = render_element(document, { fonts, text_mode: 'live', id_prefix: 'talk' })
    assert.equal(result.kind, 'document')
    assert.equal(result.title, 'A & B')
    assert.equal(result.pass.resource('fonts'), fonts)
    result.pages.forEach((page, index) => {
      assert.equal(page.pass, result.pass)
      assert.match(page.svg, /<title>A &amp; B<\/title>/)
      assert.ok(page.svg.includes(`id="talk-page-${index + 1}-clip-`))
      assert.ok(page.svg.includes(index === 0 ? '>First</text>' : '>Second</text>'))
    })
    const overridden = render_element(document, { title: 'Override' })
    assert.equal(overridden.title, 'Override')
    for (const page of overridden.pages) assert.match(page.svg, /<title>Override<\/title>/)
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} render checks passed.`)
