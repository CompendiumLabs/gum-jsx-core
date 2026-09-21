import assert from 'node:assert/strict'
import { draw_path, inspect_fragment, make_fragment, output_number_formatter, render_svg } from '../src/index'

const number = output_number_formatter()
assert.equal(number(0.1 + 0.2), '0.3')
assert.equal(number(1 / 3), '0.3333333333')
assert.equal(number(1e-16), '1e-16')
assert.equal(number(-0), '0')
assert.equal(output_number_formatter(3)(1 / 3), '0.333')
assert.equal(output_number_formatter('full')(0.1 + 0.2), '0.30000000000000004')
for (const precision of [0, 18, 1.5, NaN, Infinity]) {
  assert.throws(() => output_number_formatter(precision), /precision/)
}

const fragment = make_fragment({ size: { width: 0.1 + 0.2, height: 1 / 3 },
  draw: [draw_path([{ kind: 'M', x: 0.1 + 0.2, y: 0 },
    { kind: 'L', x: 1 / 3, y: 1e-16 }],
  { fill: 'none', stroke: 'black', stroke_width: 0.1 + 0.2 })] })
const svg = render_svg(fragment)
assert.match(svg, /width="0\.3" height="0\.3333333333"/)
assert.match(svg, /d="M0\.3 0L0\.3333333333 1e-16"/)
assert.match(svg, /stroke-width="0\.3"/)
assert.match(render_svg(fragment, { precision: 3 }), /d="M0\.3 0L0\.333 1e-16"/)
assert.match(render_svg(fragment, { precision: 'full' }), /M0\.30000000000000004 0L0\.3333333333333333 1e-16/)
assert.throws(() => render_svg(fragment, { precision: 0 }), /precision/)
assert.equal(fragment.size.width, 0.1 + 0.2)

const tree = make_fragment({ size: { width: 0.1 + 0.2, height: 1 / 3 },
  guides: { baseline: 1 / 3 },
  math: { advance: 1 / 3, left: 'none', right: 'none', italic: 0, skew: 0 },
  connection: { id: 'node', boundary: { x: 0, y: 0, width: 1 / 3, height: 1 } },
})
assert.match(inspect_fragment(tree, { precision: 3 }), /0\.3×0\.333/)
assert.match(inspect_fragment(tree, { precision: 3 }), /baseline=0\.333/)
assert.match(inspect_fragment(tree, { precision: 3 }), /"advance":0\.333/)
assert.match(inspect_fragment(tree, { precision: 3 }), /"width":0\.333/)
assert.match(inspect_fragment(tree), /0\.30000000000000004×0\.3333333333333333/)
assert.match(inspect_fragment(tree, { precision: 'full' }), /"advance":0\.3333333333333333/)
assert.equal(tree.size.width, 0.1 + 0.2)

console.log('ok - output precision rounds only serialized numbers')
