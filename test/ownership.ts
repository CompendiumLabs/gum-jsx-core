import assert from 'node:assert/strict'
import { draw_path, draw_rect, make_fragment, make_rect, place_fragment } from '../src'
import { copy_path, map_path, path_bounds, transform_path } from '../src/engine/path'
import type { PathCommand } from '../src/engine/path'
import { copy_drawing } from '../src/engine/drawing'
import { fragment_metadata } from '../src/engine/fragment'

const source = [{ kind: 'M' as const, x: 1, y: 2 }, { kind: 'L' as const, x: 3, y: 4 }]
const frozen_array = Object.freeze([...source])
const path = copy_path(frozen_array)
assert.notEqual(path, frozen_array)
source[1].x = 100
assert.equal(path[1].kind === 'L' && path[1].x, 3)
assert.ok(Object.isFrozen(path) && path.every(Object.isFrozen))
assert.equal(copy_path(path), path)
const transformed = transform_path(path, [2, 0, 0, 2, 1, 1])
assert.equal(copy_path(transformed), transformed)
assert.deepEqual(path_bounds(transformed), { x: 3, y: 5, width: 4, height: 4 })

// Generic mapping cannot vouch for a caller's coordinate callback.
const invalid = map_path(source, () => ({ x: NaN, y: 0 }))
assert.throws(() => copy_path(invalid), /finite/)
assert.throws(() => copy_path(Object.freeze([{ kind: 'L', x: 0, y: 0 }])), /move_to/)
assert.throws(() => path_bounds([{ kind: 'M', x: 0, y: 0 }, { kind: 'L', x: Infinity, y: 1 }]), /finite/)
assert.throws(() => path_bounds([{ kind: 'L', x: 0, y: 0 }]), /move_to/)
assert.throws(() => path_bounds([
  { kind: 'M', x: 0, y: 0 }, { kind: 'L', x: 1, y: 1 }, { kind: 'invalid' } as unknown as PathCommand,
]), /Unknown path command/)
assert.deepEqual(path_bounds([
  { kind: 'M', x: 0, y: 0 }, { kind: 'Q', x1: -4, y1: 9, x: 1, y: 2 },
  { kind: 'C', x1: 8, y1: -3, x2: -6, y2: 4, x: 3, y: 2 }, { kind: 'Z' },
  { kind: 'M', x: 12, y: 1 },
]), { x: -6, y: -3, width: 18, height: 12 })
assert.equal(path_bounds([{ kind: 'M', x: 1, y: 2 }]), null)

const paint = { fill: 'red', stroke: 'none', stroke_width: 0 }
const drawing = draw_path(transformed, paint)
assert.equal(drawing.commands, transformed)
assert.equal(copy_drawing(drawing), drawing)
const mutable_commands = [{ kind: 'M' as const, x: 0, y: 0 }, { kind: 'L' as const, x: 4, y: 4 }]
const external = Object.freeze({ ...drawing, commands: mutable_commands })
const copied = copy_drawing(external)
mutable_commands[1].x = 50
assert.ok(copied.kind === 'path' && copied.commands[1].kind === 'L')
assert.equal(copied.commands[1].x, 4)
assert.notEqual(copied, external)
assert.throws(() => copy_drawing(Object.freeze({ ...drawing, opacity: 2 })), /opacity/)

const leaf = make_fragment({ size: { width: 5, height: 5 }, draw: [drawing] })
assert.equal(leaf.draw[0], drawing)
const fragment = make_fragment({ size: { width: 3, height: 3 }, debug: true,
  clip: make_rect(0, 0, 3, 3), children: [place_fragment(leaf)] })
const boundary = { x: 0, y: 0, width: 3, height: 3 }
const updated = fragment_metadata(fragment, { name: 'Named', debug: false, connection: { id: 'node', boundary } })
assert.deepEqual(updated, make_fragment({ ...fragment, name: 'Named', debug: false, connection: { id: 'node', boundary } }))
assert.equal(updated.children, fragment.children)
assert.equal(updated.ink, fragment.ink)
assert.equal(fragment.debug, true)
assert.equal(updated.debug, undefined)
assert.equal(fragment.connection, undefined)
boundary.width = 30
assert.equal(updated.connection!.boundary.width, 3)
assert.equal(fragment_metadata(updated, { connection: undefined }).connection, undefined)
assert.throws(() => fragment_metadata(fragment, { connection: { id: '', boundary } }), /nonempty/)

// A shallow frozen or prototype-derived record is still caller-owned.
const rect = { x: 0, y: 0, width: 2, height: 2 }
const external_fragment = Object.freeze({ ...leaf, draw: [{ ...draw_rect(rect, paint), rect }] })
const normalized = fragment_metadata(external_fragment, { name: 'External' })
rect.width = 20
assert.ok(normalized.draw[0].kind === 'rect')
assert.equal(normalized.draw[0].rect.width, 2)
const derived = Object.create(leaf, { size: { value: { width: 5, height: 5 }, enumerable: true } })
const placed = place_fragment(derived)
derived.size.width = 50
assert.equal(placed.fragment.size.width, 5)

console.log('ok - owned geometry is reused and external records remain isolated and validated')
