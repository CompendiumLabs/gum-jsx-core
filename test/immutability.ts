import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { FREEZE_ENABLED, freeze_owned, make_size, make_measure, make_request,
  resolve_sizing, definite_reference, exact } from '../src'

const record = { value: 1 }
assert.equal(freeze_owned(record), record)
assert.equal(Object.isFrozen(record), FREEZE_ENABLED)
if (FREEZE_ENABLED) assert.throws(() => { record.value = 2 }, TypeError)
else { record.value = 2; assert.equal(record.value, 2) }
// The policy never changes the native function or deep-freezes arbitrary values.
assert.ok(Object.isFrozen(Object.freeze({ value: 1 })))
const child = { value: 1 }
freeze_owned({ child })
assert.equal(Object.isFrozen(child), false)

const input = { width: 100 }
const context = make_measure({ reference: input })
input.width = 200
assert.notEqual(context.reference, input)
assert.equal(context.reference.width, 100)
assert.equal(make_measure(context, { font_size: 12 }).reference, context.reference)
const size = make_size(40, 50)
assert.equal(make_measure({ reference: size }).reference, size)
const fixed = definite_reference(make_request({ width: exact(80) }), resolve_sizing({}))
assert.equal(make_measure({ reference: fixed }).reference, fixed)
const frozen_input = Object.freeze({ width: 70 })
assert.equal(make_measure({ reference: frozen_input }).reference, frozen_input)
const derived = Object.create(size, { width: { value: 20, writable: true, enumerable: true } })
const copied = make_measure({ reference: derived }).reference
assert.notEqual(copied, derived)
derived.width = 30
assert.equal(copied.width, 20)

// Keep Object.freeze's readonly return types and literal inference in both modes.
const literal = freeze_owned({ kind: 'point', value: 1 })
const kind: 'point' = literal.kind
assert.equal(kind, 'point')
if (false) {
  // @ts-expect-error Runtime policy never makes the public type mutable.
  literal.value = 2
}

const module_path = fileURLToPath(new URL('../src/lib/immutable.ts', import.meta.url))
const code = `import { FREEZE_ENABLED, freeze_owned } from ${JSON.stringify(module_path)};
  const before = Object.isFrozen(freeze_owned({}));
  process.env.GUM_FREEZE = FREEZE_ENABLED ? '0' : '1';
  console.log(JSON.stringify([FREEZE_ENABLED, before, Object.isFrozen(freeze_owned({}))]));`
function launch(settings: Record<string, string>) {
  const env = { ...process.env }
  delete env.GUM_FREEZE
  delete env.NODE_ENV
  Object.assign(env, settings)
  return Bun.spawnSync([process.execPath, '--eval', code], { env, stdout: 'pipe', stderr: 'pipe' })
}
for (const [settings, expected] of [
  [{}, true], [{ NODE_ENV: 'development' }, true], [{ NODE_ENV: 'test' }, true],
  [{ NODE_ENV: 'production' }, false], [{ NODE_ENV: 'production', GUM_FREEZE: '1' }, true],
  [{ NODE_ENV: 'development', GUM_FREEZE: '0' }, false],
] as const) {
  const result = launch(settings)
  assert.equal(result.exitCode, 0, result.stderr.toString())
  assert.deepEqual(JSON.parse(result.stdout.toString()), [expected, expected, expected])
}
for (const invalid of ['', 'false', 'true', '2']) {
  const result = launch({ GUM_FREEZE: invalid })
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr.toString(), /GUM_FREEZE must be 0 or 1/)
}

const entrypoint = fileURLToPath(new URL('./fixtures/freeze-browser.ts', import.meta.url))
for (const setting of [undefined, true, false] as const) {
  const build = await Bun.build({ entrypoints: [entrypoint], target: 'browser', minify: true,
    define: setting === undefined ? {} : { __GUM_FREEZE__: String(setting) } })
  assert.ok(build.success, build.logs.join('\n'))
  const js = await build.outputs[0].text()
  // Without an explicit build flag, a browser with no process globals defaults on.
  const sandbox: { freeze_result?: { enabled: boolean; frozen: boolean; native_frozen: boolean } } = {}
  runInNewContext(js, sandbox)
  assert.equal(sandbox.freeze_result?.enabled, setting ?? true)
  assert.equal(sandbox.freeze_result?.frozen, setting ?? true)
  assert.equal(sandbox.freeze_result?.native_frozen, true)
  if (setting !== undefined) {
    const conflicting = { process: { env: { GUM_FREEZE: 'invalid', NODE_ENV: 'production' } }, freeze_result: sandbox.freeze_result }
    runInNewContext(js, conflicting)
    assert.equal(conflicting.freeze_result?.enabled, setting)
  }
}
const invalid_build = await Bun.build({ entrypoints: [entrypoint], target: 'browser',
  define: { __GUM_FREEZE__: '"false"' } })
assert.ok(invalid_build.success)
const invalid_js = await invalid_build.outputs[0].text()
assert.throws(() => runInNewContext(invalid_js, {}), /__GUM_FREEZE__ must be a boolean/)
console.log('ok - freeze policy is fixed at startup, browser-safe, readonly, and independent of snapshots and reference ownership')
