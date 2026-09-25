import assert from 'node:assert/strict'
import { draw_rect, inspect_fragment, make_fragment, make_rect, make_size, place_fragment, render_svg } from '../src/index'
import type { PathCommand } from '../src/index'

const path: PathCommand[] = [
  { kind: 'M', x: 10, y: 10 }, { kind: 'L', x: 90, y: 10 },
  { kind: 'Q', x1: 50, y1: 90, x: 10, y: 10 }, { kind: 'Z' },
]
const leaf = make_fragment({ size: make_size(100, 100),
  draw: [draw_rect(make_rect(-10, -10, 120, 120), { fill: 'red', stroke: 'none', stroke_width: 0 })],
  outset: { left: 10, top: 10, right: 10, bottom: 10 },
})
const clipped = make_fragment({ size: leaf.size, clip_path: path,
  clip: make_rect(20, 0, 60, 100), children: [place_fragment(leaf)] })
assert.deepEqual(clipped.ink, make_rect(20, 10, 60, 80))
assert.deepEqual(clipped.overflow, leaf.overflow)
assert.equal(clipped.outset, undefined)
assert.ok(Object.isFrozen(clipped.clip_path))
assert.ok(Object.isFrozen(clipped.clip_path![0]))
path[0] = { kind: 'M', x: 0, y: 0 }
assert.deepEqual(clipped.clip_path![0], { kind: 'M', x: 10, y: 10 })

const scene = make_fragment({ size: make_size(220, 100), children: [
  place_fragment(clipped), place_fragment(clipped, [110, 0]),
] })
const svg = render_svg(scene)
assert.equal(svg.match(/<clipPath /g)?.length, 2)
assert.equal(svg.match(/<g clip-path="url\(#gum-clip-0\)"><g clip-path="url\(#gum-path-clip-0\)">/g)?.length, 2)
assert.match(svg, /<path d="M10 10L90 10Q50 90 10 10Z"/)

const empty = make_fragment({ size: leaf.size, clip_path: [], children: [place_fragment(leaf)] })
assert.equal(empty.ink, null)
assert.equal(empty.outset, undefined)
assert.match(inspect_fragment(empty).split('\n')[0], /clipped$/)
assert.match(render_svg(empty), /<clipPath[^>]*><path d=""\/><\/clipPath>/)
assert.throws(() => make_fragment({ size: leaf.size, clip_path: [{ kind: 'M', x: NaN, y: 0 }] }), /finite/)
console.log('ok - path clips own their commands, bound ink, intersect rectangle clips, and share SVG definitions')
