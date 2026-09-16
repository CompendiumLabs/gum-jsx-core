import assert from 'node:assert/strict'
import { LayoutPass, PngImage, Rect, px, make_request, exact, available, render_svg, evaluate,
  draw_image, make_rect, make_fragment } from '../src/index'

const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAGklEQVR4XmP4zwBEIMjwHwggbBBqYAACkBAAKooSbzGPaPkAAAAASUVORK5CYII='
const pass = new LayoutPass()
assert.deepEqual(pass.layout(new PngImage({ data })).size, { width: 4, height: 2 })
assert.deepEqual(pass.layout(new PngImage({ data, width: px(80) })).size, { width: 80, height: 40 })
assert.deepEqual(pass.layout(new PngImage({ data, height: px(30) })).size, { width: 60, height: 30 })
assert.deepEqual(pass.layout(new PngImage({ data }), make_request({
  width: available(60), height: available(20),
})).size, { width: 40, height: 20 })
const square = pass.layout(new PngImage({ data, opacity: 0.5 }), make_request({
  width: exact(80), height: exact(80),
}))
assert.deepEqual(square.ink, { x: 0, y: 20, width: 80, height: 40 })
assert.deepEqual(square.size, { width: 80, height: 80 })
assert.ok(Object.isFrozen(square.draw[0]))
const svg = render_svg(square)
assert.ok(svg.includes('xmlns:xlink="http://www.w3.org/1999/xlink"'))
assert.ok(svg.includes('<image x="0" y="20" width="80" height="40"'))
assert.ok(svg.includes(`xlink:href="${data}"`))
assert.ok(svg.includes('opacity="0.5"'))
assert.ok(evaluate(`<PngImage data="${data}" />`) instanceof PngImage)
assert.equal(pass.layout(new PngImage({ data, width: px(0) })).ink, null)
assert.equal(pass.layout(new PngImage({ data, opacity: 0 })).ink, null)
assert.throws(() => pass.layout(new PngImage({ data, children: new Rect() })), /no content children/)
for (const invalid of ['', 'https://example.com/image.png', 'data:image/jpeg;base64,abcd',
  'data:image/png;base64,@@@@', 'data:image/png;base64,YWJjZA==']) {
  assert.throws(() => pass.layout(new PngImage({ data: invalid })), /PNG|PngImage/)
}
const bytes = Buffer.from(data.slice(22), 'base64')
bytes.writeUInt32BE(0, 16)
assert.throws(() => pass.layout(new PngImage({ data: `data:image/png;base64,${bytes.toString('base64')}` })), /dimensions/)
assert.throws(() => draw_image(make_rect(0, 0, 1, 1), data, 2), /opacity/)
const injection = render_svg(make_fragment({ size: { width: 1, height: 1 },
  draw: [draw_image(make_rect(0, 0, 1, 1), 'data:image/png;base64,"/><script>')] }))
assert.ok(!injection.includes('<script>'))
console.log('ok - PNG layout, aspect, SVG embedding, evaluator, opacity, and validation')
