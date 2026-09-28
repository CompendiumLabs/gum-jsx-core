import { FREEZE_ENABLED } from '../src/lib/immutable'
import assert from 'node:assert/strict'
import { make_point } from '../src/engine/geometry'
import type { Transform } from '../src/engine/geometry'
import { copy_path, map_path, transform_path } from '../src/engine/path'
import type { PathCommand } from '../src/engine/path'

const outcome = (operation: () => unknown) => {
  try { return { value: operation() } }
  catch (error) {
    assert.ok(error instanceof Error)
    return { error: error.name, message: error.message }
  }
}
const transforms: Transform[] = [
  [1, 0, 0, 1, 0, 0], [2, 0, 0, 3, 5, -4], [0, 1, -1, 0, 0, 0],
  [1, 0.5, -0.25, 1, 9, 11], [0, 0, 0, 0, 0, 0], [-0, 0, 0, -0, -0, -0],
  [1, 0, 0, 1, 1e16, -1e16], [Number.MAX_VALUE, 0, 0, 1, 0, 0], [NaN, 0, 0, 1, 0, 0],
]
const commands: PathCommand[] = [
  { kind: 'M', x: -0, y: 0 }, { kind: 'L', x: 1 / 3, y: -2.5 },
  { kind: 'Q', x1: -4, y1: 5, x: 6, y: 7 },
  { kind: 'C', x1: 8, y1: -9, x2: 10, y2: 11, x: -12, y: 13 }, { kind: 'Z' },
]

// Generic mapping remains an independent reference for numeric copies and
// transformations. Exercise every control coordinate, overflow, and signed zero.
const check = (path: readonly PathCommand[]) => {
  assert.deepEqual(outcome(() => copy_path(path)), outcome(() => map_path(path, make_point)))
  for (const transform of transforms) {
    const [a, b, c, d, e, f] = transform
    assert.deepEqual(outcome(() => transform_path(path, transform)), outcome(() => map_path(path,
      (x, y) => make_point(a * x + c * y + e, b * x + d * y + f))))
  }
}
check([])
check(commands)
check([{ kind: 'L', x: 0, y: 0 }])
check([...commands, { kind: 'unknown' } as unknown as PathCommand])
const values = [-0, 0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e16, Number.MAX_VALUE, NaN,
  Infinity, -Infinity, undefined as unknown as number]
for (let i = 0; i < commands.length; i++) {
  for (const field of Object.keys(commands[i]).filter(key => key !== 'kind')) {
    for (const value of values) {
      const path = [...commands]
      path[i] = { ...commands[i], [field]: value }
      check(path)
    }
  }
}
const copy = copy_path(commands)
assert.ok((Object.isFrozen(copy) === FREEZE_ENABLED) && copy.every(value => Object.isFrozen(value) === FREEZE_ENABLED))
assert.equal(copy_path(copy), copy)
const transformed = transform_path(commands, transforms[1])
assert.ok((Object.isFrozen(transformed) === FREEZE_ENABLED) && transformed.every(value => Object.isFrozen(value) === FREEZE_ENABLED))
assert.equal(copy_path(transformed), transformed)
assert.ok(!Object.isFrozen(commands) && commands.every(command => !Object.isFrozen(command)))

console.log('ok - numeric paths preserve generic mapping results, validation, and ownership')
