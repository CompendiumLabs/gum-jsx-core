import assert from 'node:assert/strict'
import { Element, LayoutPass, make_fragment, make_size, make_request, available, exact,
  copy_math_context, copy_math_metrics, inspect_fragment } from '../src'
import type { LayoutQuery, MathContext } from '../src'

let preparations = 0
class Probe extends Element {
  static layout(_props: {}, query: LayoutQuery) {
    const context = query.prepare('context', () => { preparations++; return query.math })
    return make_fragment({ size: make_size(), guides: { math_axis: -5, baseline: 3 },
      math: { advance: -(context?.size ?? 1), left: 'none', right: 'none', italic: 2, skew: -3 } })
  }
}
const source = new Probe(), pass = new LayoutPass()
const input: MathContext = { style: 'script-cramped', size: 2 }
const a = pass.layout(source, make_request(), { math: input })
const b = pass.layout(source, make_request({ width: available(100) }), { math: { ...input } })
assert.deepEqual(a.math, b.math)
assert.equal(preparations, 1)
assert.equal(pass.layout(source, make_request(), { math: { ...input } }), a)
assert.equal(a.math?.advance, -2)
assert.equal(a.guides.math_axis, -5)
assert.ok(Object.isFrozen(a.math))
assert.ok(inspect_fragment(a).includes('"advance":-2'))
const c = pass.layout(source, make_request(), { math: { style: 'display', size: 1 } })
assert.equal(c.math?.advance, -1)
assert.equal(preparations, 2)
pass.set_resource('revision', {}, 2)
assert.notEqual(pass.layout(source, make_request(), { math: input }), a)
assert.equal(preparations, 3)

class Parent extends Element {
  static layout(_props: {}, query: LayoutQuery) {
    return query.child(source, make_request(), {}, 0)
  }
}
assert.equal(pass.layout(new Parent(), make_request(), { math: input }).math?.advance, -2)
assert.ok(Object.isFrozen(copy_math_context(input)))
assert.throws(() => copy_math_context({ style: 'invalid', size: 1 } as any), /style/)
assert.throws(() => copy_math_context({ style: 'text', size: 0 }), /positive/)
assert.throws(() => copy_math_metrics({ ...a.math!, advance: Infinity }), /finite/)
assert.throws(() => copy_math_metrics({ ...a.math!, left: 'invalid' } as any), /class/)
assert.throws(() => make_fragment({ size: make_size(-1, 0) }), /nonnegative/)
assert.equal(pass.layout(source, make_request({ width: exact(0) }), { math: input }).size.width, 0)
console.log('Math protocol: passive metrics, context caching, inheritance, and validation passed.')
