import assert from 'node:assert/strict'
import {
  Svg, Slide, Text, Box, Graph, Plot, LayoutPass, evaluate,
  px, em, exact, make_request, make_insets, render_svg,
} from '../src/index'
import type { Fragment } from '../src/index'

function named(fragment: Fragment, name: string): Fragment[] {
  return [ ...(fragment.name === name ? [fragment] : []),
    ...fragment.children.flatMap(child => named(child.fragment, name)) ]
}
function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

const tests: Record<string, () => void> = {
  'slides inherit the Svg font and honor local overrides at every viewport size'() {
    for (const base of [12, 24]) {
      for (const [font_size, resolved] of [[undefined, base], [em(1.5), base * 1.5], [px(18), 18]] as const) {
        const source = new Svg({ font_size: px(base), children: new Slide({
          ...(font_size === undefined ? {} : { font_size }), title: 'Title', children: 'Body',
        }) })
        const pass = new LayoutPass()
        for (const width of [640, 960]) {
          const root = pass.layout(source, make_request({ width: exact(width), height: exact(width * 9 / 16) }))
          const slide = named(root, 'Slide')[0], [title, body] = named(root, 'Text')
          near(slide.content!.x, resolved * 1.5)
          near(title.children[0].fragment.size.height, resolved * 1.6 * 1.2)
          near(body.children[0].fragment.size.height, resolved * 1.2)
        }
      }
    }
    const root = new LayoutPass().layout(new Slide({ children: 'Body' }))
    near(named(root, 'Text')[0].children[0].fragment.size.height, 16 * 1.2)
  },

  'a lone plot or graph fills the remaining slide body without overflow'() {
    for (const Content of [Plot, Graph]) {
      for (const title of [undefined, 'Title']) {
        const source = new Slide({ title, children: new Content() }), pass = new LayoutPass()
        for (const width of [320, 640, 960]) {
          const slide = pass.layout(source, make_request({ width: exact(width), height: exact(width * 9 / 16) }))
          const body = named(slide, 'Box')[0], content = named(slide, Content.name)[0]
          assert.deepEqual(content.size, body.size)
          near(content.size.width, slide.content!.width)
          const heading = title ? named(slide, 'Text')[0].size.height + 16 * 0.8 : 0
          near(content.size.height, slide.content!.height - heading)
          assert.deepEqual(body.overflow, make_insets())
          assert.deepEqual(slide.overflow, make_insets())
        }
      }
    }
  },

  'nested columns, rows, and captioned figures receive the finite body budget'() {
    for (const content of [
      '<TextCol><Plot grow={1}/><Text>Caption</Text></TextCol>',
      '<HStack align="fill"><Plot grow={1}/><Plot grow={1}/></HStack>',
      '<TextFigure caption="Caption"><Plot grow={1}/></TextFigure>',
    ]) {
      // Whitespace and conditional children must not introduce another column.
      const source = evaluate(`<Slide title="Title">\n {false} ${content} {null}\n </Slide>`)
      const before = JSON.stringify(source), pass = new LayoutPass()
      for (const width of [640, 960]) {
        const slide = pass.layout(source, make_request({ width: exact(width), height: exact(width * 9 / 16) }))
        const body = named(slide, 'Box')[0]
        assert.deepEqual(body.overflow, make_insets(), content)
        assert.deepEqual(body.children[0].fragment.size, body.size, content)
        for (const plot of named(slide, 'Plot')) {
          assert.ok(plot.size.height > body.size.height / 2, content)
          assert.ok(plot.size.height <= body.size.height, content)
        }
        assert.deepEqual(slide.overflow, make_insets(), content)
      }
      assert.equal(JSON.stringify(source), before)
    }
  },

  'slide fill respects explicit title and body sizes and body limits'() {
    const pass = new LayoutPass(), title = new Text({ children: 'Title', width: px(100) })
    const request = make_request({ width: exact(640), height: exact(360) })
    const fixed = pass.layout(new Slide({ title, children: new Box({ width: px(120), height: px(60) }) }), request)
    assert.equal(named(fixed, 'Text')[0].size.width, 100)
    assert.deepEqual(named(fixed, 'Box').at(-1)!.size, { width: 120, height: 60 })
    const limited = pass.layout(new Slide({ children: new Graph({ max_width: px(200), max_height: px(100) }) }), request)
    assert.deepEqual(named(limited, 'Graph')[0].size, { width: 200, height: 100 })
    const fit = pass.layout(new Slide({ children: new Text({ children: 'Compact', align_self: { x: 'start' } }) }), request)
    assert.ok(named(fit, 'Text')[0].size.width < 100)
  },

  'multiple slide children retain text column spacing and explicit flex weights'() {
    const source = evaluate(`<Slide title="Title">
      <Graph grow={2}/><Graph grow={1}/><Text>Caption</Text>
    </Slide>`)
    const slide = new LayoutPass().layout(source, make_request({ width: exact(640), height: exact(360) }))
    const [first, second] = named(slide, 'Graph'), column = named(slide, 'TextCol')[0]
    const caption = named(column, 'Text')[0]
    near(first.size.height, 2 * second.size.height)
    near(first.size.height + second.size.height + caption.size.height + 2 * 16 * 0.6, column.size.height)
    assert.deepEqual(column.overflow, make_insets())
  },

  'explicitly oversized content retains its geometry and clipping remains optional'() {
    const pass = new LayoutPass(), request = make_request({ width: exact(640), height: exact(360) })
    const children = new Box({ width: px(1000), height: px(1000), background: 'blue' })
    const visible = pass.layout(new Slide({ children }), request)
    const clipped = pass.layout(new Slide({ children, clip: true }), request)
    assert.deepEqual(named(visible, 'Box').at(-1)!.size, { width: 1000, height: 1000 })
    assert.ok(visible.overflow.right > 0 && visible.overflow.bottom > 0)
    assert.equal(visible.clip, undefined)
    assert.deepEqual(clipped.overflow, visible.overflow)
    assert.deepEqual(clipped.ink, { x: 24, y: 24, width: 616, height: 336 })
    const painted = pass.layout(new Slide({ children, clip: true, background: 'white' }), request)
    assert.deepEqual(painted.ink, { x: 0, y: 0, width: 640, height: 360 })
    const tiny = pass.layout(new Slide({ title: 'Title', children: new Graph() }),
      make_request({ width: exact(0), height: exact(0) }))
    assert.doesNotMatch(render_svg(tiny), /NaN|Infinity/)
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} slide checks passed.`)
