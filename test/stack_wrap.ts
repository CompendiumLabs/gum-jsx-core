import assert from 'node:assert/strict'
import { evaluate, layout_element, LayoutPass, make_request, exact, available } from '../src/index'
import type { Element } from '../src/index'

const parse = (source: string): Element => evaluate(source)
const source = parse(`<HStack wrap gap={px(10)} line-gap={px(6)}>
  <Rect grow={1} shrink={1} basis={px(120)} aspect={2} stroke={none} />
  <Rect grow={1} shrink={1} basis={px(120)} aspect={2} stroke={none} />
  <Rect grow={1} shrink={1} basis={px(120)} aspect={2} stroke={none} />
</HStack>`)
const layout = (width: number) => layout_element(source, {
  request: make_request({ width: exact(width) }),
}).fragment.children[0]!.fragment

const wide = layout(400)
assert.equal(wide.children.length, 1)
assert.equal(wide.children[0]!.fragment.children.length, 3)
assert.ok(Math.abs(wide.size.width - 400) < 1e-9)
assert.ok(Math.abs(wide.size.height - 190 / 3) < 1e-9)

const narrow = layout(250)
assert.equal(narrow.children.length, 2)
assert.deepEqual(narrow.children.map(row => row.fragment.children.length), [2, 1])
assert.equal(narrow.children[1]!.offset.y, 66)
assert.equal(narrow.size.height, 191)
assert.equal(narrow.overflow.right, 0)

// A single card still shrinks below its basis; wrapping does not impose a minimum.
const tiny = layout(80)
assert.equal(tiny.children.length, 3)
assert.equal(tiny.size.height, 132)
assert.equal(tiny.overflow.right, 0)

// Fractions still tile the space remaining after the row's gaps.
const halves = layout_element(parse(`<HStack wrap gap={px(10)}>
  <Rect width={0.5} height={px(20)} stroke={none} />
  <Rect width={0.5} height={px(20)} stroke={none} />
</HStack>`), { request: make_request({ width: exact(250) }) }).fragment.children[0]!.fragment
assert.equal(halves.children.length, 1)
assert.deepEqual(halves.children[0]!.fragment.children.map(item => item.fragment.size.width), [120, 120])

// A wrapping row still honors an explicitly nonshrinking item.
const fixed = layout_element(parse(`<HStack wrap>
  <Rect width={px(300)} height={px(20)} stroke={none} />
</HStack>`), { request: make_request({ width: exact(200) }) }).fragment
assert.equal(fixed.overflow.right, 100)

// Relative typography is inherited once through the generated row.
const text = layout_element(parse(`<HStack wrap font-size={em(2)}>
  <Text>Label</Text>
</HStack>`), { request: make_request({ width: exact(200) }) }).fragment
const plain = layout_element(parse('<Text font-size={em(2)}>Label</Text>')).fragment
assert.equal(text.size.height, plain.size.height)
assert.throws(() => layout_element(evaluate('<VStack wrap><Text>Invalid</Text></VStack>')), /horizontal stacks/)

// An advisory budget chooses line breaks, not empty space to the right.
const packed = parse(`<HStack wrap gap={px(10)} line-gap={px(6)} justify="center">
  <Rect width={px(120)} height={px(20)} stroke={none} />
  <Rect width={px(120)} height={px(20)} stroke={none} />
  <Rect width={px(120)} height={px(20)} stroke={none} />
</HStack>`)
const pass = new LayoutPass()
for (const width of [400, 640, 1000]) {
  const result = pass.layout(packed, make_request({ width: available(width) }))
  assert.deepEqual(result.size, { width: 380, height: 20 })
  assert.deepEqual(result.children[0].fragment.children.map(child => child.offset.x), [0, 130, 260])
}
const wrapped = pass.layout(packed, make_request({ width: available(300) }))
assert.deepEqual(wrapped.size, { width: 250, height: 46 })
assert.equal(wrapped.children[1].fragment.children[0].offset.x, 65)
const allocated = pass.layout(packed, make_request({ width: exact(300) }))
assert.equal(allocated.size.width, 300)
assert.equal(allocated.children[1].fragment.children[0].offset.x, 90)

// Fractions keep the original line budget as their reference; hugging does not
// feed the measured width back into child percentages.
const fractions = pass.layout(parse(`<HStack wrap gap={px(10)}>
  <Rect width={0.2} height={px(20)} stroke={none} />
  <Rect width={0.2} height={px(20)} stroke={none} />
</HStack>`), make_request({ width: available(250) }))
assert.equal(fractions.size.width, 106)
assert.deepEqual(fractions.children[0].fragment.children.map(child => child.fragment.size.width), [48, 48])
const empty = pass.layout(parse('<HStack wrap />'), make_request({ width: available(300) }))
assert.deepEqual(empty.size, { width: 0, height: 0 })
console.log('ok - horizontal wrapping reflows flex rows at the offered width')
