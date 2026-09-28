import assert from 'node:assert/strict'
import { make_rect, transform_rect, union_rects } from '../src/engine/geometry'
import type { PointValue, Rect, Transform } from '../src/engine/geometry'

const identity: Transform = [1, 0, 0, 1, 0, 0]
const outcome = (operation: () => unknown) => {
  try { return { value: operation() } }
  catch (error) {
    assert.ok(error instanceof Error)
    return { error: error.name, message: error.message }
  }
}

// The general affine path is an independent check of translation arithmetic,
// including the rounded extent after large offsets and malformed input errors.
const values = [-Number.MAX_VALUE, -1e16, -100.25, -Number.MIN_VALUE, -0,
  0, Number.MIN_VALUE, 0.1, 1 / 3, 100.25, 1e16, Number.MAX_VALUE, NaN, Infinity, -Infinity]
for (let i = 0; i < values.length; i++) {
  for (let j = 0; j < values.length; j++) {
    const rect = { x: values[i], y: values[j], width: values[(i + j) % values.length], height: values[(i * 3 + j) % values.length] }
    for (const offset of [{ x: values[j], y: values[i] }, [values[j], values[i]] as const]) {
      assert.deepEqual(outcome(() => transform_rect(rect, offset)),
        outcome(() => transform_rect(rect, offset, identity)))
    }
  }
}
let seed = 12345
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5)
for (let i = 0; i < 1000; i++) {
  const scale = 10 ** (i % 40 - 20)
  const rect = { x: random() * scale, y: random() * scale, width: random() * scale, height: random() * scale }
  const offset = { x: random() / scale, y: random() / scale }
  assert.deepEqual(transform_rect(rect, offset), transform_rect(rect, offset, identity))
}
for (const invalid of [null, {}, [], [0], [0, 0, 0]]) {
  const offset = invalid as unknown as PointValue
  assert.deepEqual(outcome(() => transform_rect(make_rect(1, 2, 3, 4), offset)),
    outcome(() => transform_rect(make_rect(1, 2, 3, 4), offset, identity)))
}
assert.equal(transform_rect(null, null as unknown as PointValue), null)
const translated = transform_rect(make_rect(-2, 3, 4, 5), [10, -4])!
assert.deepEqual(translated, { x: 8, y: -1, width: 4, height: 5 })
assert.ok(Object.isFrozen(translated))
assert.deepEqual(transform_rect(make_rect(0, 0, 1, 1), [1e16, 1e16]), {
  x: 1e16, y: 1e16, width: 0, height: 0,
})
assert.deepEqual(transform_rect(make_rect(1, 2, 3, 4), [5, 6], [0, 1, -1, 0, 0, 0]), {
  x: -1, y: 7, width: 4, height: 3,
})
assert.deepEqual(transform_rect(make_rect(1, 2, 3, 4), [5, 6], [0, 0, 0, 0, 0, 0]), {
  x: 5, y: 6, width: 0, height: 0,
})

assert.equal(union_rects(), null)
assert.equal(union_rects(null, null), null)
const zero = { x: -0, y: -0, width: 0, height: 0 }
assert.deepEqual(union_rects(null, zero), zero)
const input = [{ x: -10, y: 2, width: 5, height: 4 }, { x: 8, y: -4, width: 0, height: 0 }]
const union = union_rects(null, ...input, null)!
assert.deepEqual(union, { x: -10, y: -4, width: 18, height: 10 })
assert.ok(Object.isFrozen(union))
assert.ok(input.every(rect => !Object.isFrozen(rect)))
input[0].x = -100
assert.equal(union.x, -10)
for (const value of [NaN, Infinity, -Infinity]) {
  for (const field of ['x', 'y', 'width', 'height']) {
    assert.throws(() => union_rects(null, { x: 0, y: 0, width: 1, height: 1, [field]: value }), /finite/)
  }
}
const many: Rect[] = Array.from({ length: 10000 }, (_, i) => ({ x: i, y: -i, width: 1, height: 2 }))
assert.deepEqual(union_rects(...many), { x: 0, y: -9999, width: 10000, height: 10001 })

console.log('ok - rectangle bounds preserve translation, affine, empty, and finite-value behavior')
