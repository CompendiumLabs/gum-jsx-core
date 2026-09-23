import assert from 'node:assert/strict'
import { Frame, Rect, Plot, SymLine, Text, Circle, define_component, evaluate,
  register_props, render_element, px } from '../src/index'
import { ErrorRuntime } from '../src/lib/errors'

assert.throws(() => new Frame({ paddding: px(20) } as any), /Frame: unknown prop "paddding".*"padding"/)
assert.throws(() => new Rect({ radius: px(8) } as any), {
  message: 'Rect: unknown prop "radius". Check this element’s supported props.',
})
assert.throws(() => new Frame({ spacing: px(4) } as any), {
  message: 'Frame: unknown prop "spacing". Check this element’s supported props.',
})
assert.throws(() => new Circle({ title: 'ignored' } as any), /unknown prop "title"/)
assert.throws(() => new SymLine({ samplez: 8 } as any), /SymLine: unknown prop.*"samples"/)
assert.throws(() => new Plot({ xaxis_label_colour: 'red' } as any), /xaxis_label_color/)

try {
  evaluate('<Frame\n  paddding={px(20)}\n/>', { name: 'typo.jsx' })
  assert.fail('Expected a source diagnostic')
} catch (error) {
  assert.ok(error instanceof ErrorRuntime)
  assert.match(error.message, /padding/)
  assert.ok(error.sites.some(site => site.element === 'Frame'))
}

// Scoped callbacks are accepted before normalizers consume them; layout and
// parent-owned metadata must remain available to their owning containers.
assert.doesNotThrow(() => render_element(new Plot({
  width: px(320), height: px(240), xaxis_label_color: 'red',
  xaxis_format: value => String(value), title_font_size: px(16),
  children: new Circle({ x: 0.5, y: 0.5, anchor: 'center', grow: 1,
    basis: px(10), align_self: 'center', width: px(10) }),
})))
assert.doesNotThrow(() => evaluate('<Text font-size={px(20)}>Hello</Text>'))

class CustomFrame extends Frame {}
assert.doesNotThrow(() => new CustomFrame({ application_label: 'allowed' } as any))
const CustomComponent = define_component<any>('CustomComponent', ({ label }) => new Text({ children: label }))
assert.doesNotThrow(() => new CustomComponent({ label: 'Custom props remain supported' }))
register_props(CustomComponent, ['label'])
assert.throws(() => new CustomComponent({ lable: 'typo' }), /CustomComponent.*"label"/)

console.log('ok - built-in prop diagnostics preserve source sites, scopes, and custom extensions')
