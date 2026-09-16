import assert from 'node:assert/strict'
import { TitleFrame, LayoutPass, px, em, make_request, exact, available, render_svg } from '../src/index'
import { Fixed } from './fixtures/leaves'

const tests: Record<string, () => void> = {
  'titles inherit normal weight by default and retain explicit weight overrides'() {
    const pass = new LayoutPass()
    const props = { width: px(240), title: 'A framed title', children: 'Body text' }
    const normal = pass.layout(new TitleFrame(props))
    const explicit = pass.layout(new TitleFrame({ ...props, title_font_weight: 400 }))
    const bold = pass.layout(new TitleFrame({ ...props, title_font_weight: 700 }))
    assert.equal(render_svg(normal), render_svg(explicit))
    assert.notEqual(render_svg(normal), render_svg(bold))
    assert.equal(render_svg(bold), render_svg(pass.layout(new TitleFrame({
      ...props, title_style: { font_weight: 700 },
    }))))
    assert.equal(render_svg(normal.children[0].fragment.children[0].fragment),
      render_svg(bold.children[0].fragment.children[0].fragment))
    assert.equal(render_svg(pass.layout(new TitleFrame({ ...props, font_weight: 700 }))),
      render_svg(pass.layout(new TitleFrame({ ...props, font_weight: 700, title_font_weight: 700 }))))
  },

  'boxed titles straddle the border and default to centered'() {
    const source = new TitleFrame({
      width: px(200), padding: px(4), gap: px(6), title_padding: px(3),
      title: new Fixed({ content_width: px(40), content_height: px(20) }),
      children: new Fixed({ content_width: px(80), content_height: px(30) }),
    })
    const before = JSON.stringify(source)
    const pass = new LayoutPass(), result = pass.layout(source)
    const [body, title] = result.children
    assert.deepEqual(title.fragment.size, { width: 48, height: 28 })
    assert.deepEqual(title.offset, { x: 76, y: 0 })
    assert.equal(body.offset.y, 14)
    assert.equal(result.size.height, 70)
    assert.equal(result.content!.y, 35)
    assert.equal(result.guides.baseline, 59)
    // Transparent title boxes still remove the body border underneath them.
    const border = body.fragment.children.at(-1)!.fragment
    assert.equal(border.children.length, 3)
    for (const region of border.children) {
      const clip = region.fragment.clip!
      assert.ok(clip.y >= 14 || clip.x + clip.width <= 76 || clip.x >= 124)
    }
    assert.equal(pass.layout(source), result)
    assert.equal(JSON.stringify(source), before)
  },

  'title positions and natural widths include the whole title box'() {
    const pass = new LayoutPass()
    for (const [position, fraction] of [['start', 0], ['center', 0.5], ['end', 1], [0.25, 0.25]] as const) {
      const source = new TitleFrame({ title_position: position, title_padding: px(0),
        title: new Fixed({ content_width: px(100) }), children: new Fixed({ content_width: px(10) }) })
      const natural = pass.layout(source)
      assert.equal(natural.size.width, 102)
      const fixed = pass.layout(source, make_request({ width: exact(200), height: exact(120) }))
      assert.deepEqual(fixed.size, { width: 200, height: 120 })
      assert.equal(fixed.children[1].offset.x, 98 * fraction)
    }
  },

  'title styling is scoped and clipping leaves the raised title visible'() {
    const pass = new LayoutPass()
    const props = { width: px(200), height: px(100), clip: true, font_size: px(10),
      title: new Fixed({ content_width: em(2), content_height: em(1) }),
      children: new Fixed({ content_width: em(2), content_height: em(1) }) }
    const flat = new TitleFrame({ ...props, title_font_size: em(2), title_padding: em(0.5), title_background: 'navy' })
    const nested = new TitleFrame({ ...props, title_style: { font_size: em(2), padding: em(0.5), background: 'navy' } })
    const result = pass.layout(flat)
    assert.equal(render_svg(result), render_svg(pass.layout(nested)))
    assert.deepEqual(result.children[1].fragment.size, { width: 62, height: 42 })
    assert.equal(result.clip, undefined)
    assert.ok(result.children[0].fragment.children[0].fragment.clip)
    const tiny = pass.layout(flat, make_request({ width: exact(8), height: exact(0) }))
    assert.deepEqual(tiny.size, { width: 8, height: 0 })
    assert.doesNotMatch(render_svg(tiny), /NaN|Infinity/)
  },

  'absent titles keep the ordinary frame layout'() {
    const result = new LayoutPass().layout(new TitleFrame({ padding: px(4),
      children: new Fixed({ content_width: px(40), content_height: px(20) }) }))
    assert.deepEqual(result.size, { width: 50, height: 30 })
    assert.deepEqual(result.content, { x: 5, y: 5, width: 40, height: 20 })
  },

  'frame_aspect sizes the bordered body independently of title height'() {
    const pass = new LayoutPass()
    for (const font_size of [px(12), px(36)]) {
      const source = new TitleFrame({ width: px(200), frame_aspect: 1, title_font_size: font_size,
        title: 'Square', children: new Fixed({ content_width: px(40), content_height: px(20) }) })
      const result = pass.layout(source), [body, title] = result.children
      assert.deepEqual(body.fragment.size, { width: 200, height: 200 })
      assert.equal(result.size.height, 200 + title.fragment.size.height / 2)
      assert.equal(body.offset.y, title.fragment.size.height / 2)
      assert.equal(title.offset.x, (200 - title.fragment.size.width) / 2)
      assert.equal(pass.layout(source), result)
    }
    const title = new Fixed({ content_width: px(40), content_height: px(20) })
    const props = { frame_aspect: 1, title, title_padding: px(3) }
    const filled = pass.layout(new TitleFrame({ ...props, width: 'fill' }),
      make_request({ width: available(200) }))
    assert.deepEqual(filled.size, { width: 200, height: 214 })
    const height = pass.layout(new TitleFrame({ ...props, height: px(214) }))
    assert.deepEqual(height.children[0].fragment.size, { width: 200, height: 200 })
    assert.deepEqual(height.size, filled.size)
    const allocated = pass.layout(new TitleFrame({ ...props, width: px(200) }),
      make_request({ width: exact(160), height: exact(100) }))
    assert.deepEqual(allocated.size, { width: 160, height: 100 })
    assert.deepEqual(allocated.children[0].fragment.size, { width: 160, height: 86 })
    const untitled = pass.layout(new TitleFrame({ width: px(200), frame_aspect: 1 }))
    assert.deepEqual(untitled.size, { width: 200, height: 200 })
    for (const frame_aspect of [0, -1, Infinity, NaN]) {
      assert.throws(() => pass.layout(new TitleFrame({ ...props, frame_aspect })), /frame_aspect/)
    }
  },

  'generic title frame aspect includes the raised title and keeps the border aligned'() {
    const pass = new LayoutPass()
    const title = new Fixed({ content_width: px(40), content_height: px(20) })
    const props = { aspect: 1, title, title_padding: px(3) }
    for (const sizing of [{ width: px(200) }, { height: px(200) }]) {
      const result = pass.layout(new TitleFrame({ ...props, ...sizing }))
      assert.deepEqual(result.size, { width: 200, height: 200 })
      assert.deepEqual(result.children[0].fragment.size, { width: 200, height: 186 })
      assert.deepEqual(result.children[0].offset, { x: 0, y: 14 })
    }
    for (const aspect of [0.5, 1, 2]) {
      const result = pass.layout(new TitleFrame({ ...props, aspect, children:
        new Fixed({ content_width: px(40), content_height: px(60) }) }))
      const [body, label] = result.children
      assert.equal(result.size.width / result.size.height, aspect)
      assert.equal(body.fragment.size.width, result.size.width)
      assert.equal(body.fragment.size.height + body.offset.y, result.size.height)
      assert.equal(label.offset.x, (result.size.width - label.fragment.size.width) / 2)
    }
    const both = pass.layout(new TitleFrame({ ...props, width: px(200), frame_aspect: 1 }))
    // The outer element allocation takes precedence over the body preference.
    assert.deepEqual(both.size, { width: 200, height: 200 })
    assert.deepEqual(both.children[0].fragment.size, { width: 200, height: 186 })
    for (const title of [undefined, props.title]) {
      const natural = pass.layout(new TitleFrame({ aspect: 1, frame_aspect: 2, title,
        children: new Fixed({ content_width: px(40), content_height: px(20) }) }))
      assert.equal(natural.size.width, natural.size.height)
    }
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} title frame checks passed.`)
