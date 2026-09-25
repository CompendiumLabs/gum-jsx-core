import assert from 'node:assert/strict'
import { Evaluator, evaluate, evaluate_prelude, Text, Rect } from '../src/index'
import { ErrorRuntime } from '../src/lib/errors'

const tests: Record<string, () => void> = {
  'default evaluators preserve standalone results and built-ins'() {
    const evaluator = new Evaluator()
    const code = '<Text font-size={px(24)}>{sin(pi / 2)}</Text>'
    assert.deepEqual(evaluator.evaluate(code), evaluate(code))
    assert.deepEqual(evaluator.evaluate_prelude('const value = range(3)'),
      evaluate_prelude('const value = range(3)'))
    const value = { answer: 42 }
    assert.equal(evaluator.evaluate('return value', { scope: { value } }), value)
    assert.equal(evaluator.evaluate('const local = 42'), undefined)
  },

  'call bindings override evaluator bindings, which override core bindings'() {
    const evaluator = new Evaluator({ scope: { Label: Text, color: 'navy', pi: 3 } })
    const source = '<Label fill={color}>{pi}</Label>'
    const label = evaluator.evaluate(source)
    assert.ok(label instanceof Text)
    assert.equal(label.props.fill, 'navy')
    assert.deepEqual(label.props.children, [3])
    assert.ok(evaluator.evaluate('<Rect />') instanceof Rect)
    assert.equal(evaluator.evaluate(source, { scope: { color: 'red' } }).props.fill, 'red')
    assert.ok(evaluator.evaluate('<Label />', { scope: { Label: Rect } }) instanceof Rect)
    assert.equal(evaluator.evaluate('return color', { scope: { color: undefined } }), undefined)
    assert.equal(evaluator.evaluate(source).props.fill, 'navy')
  },

  'instances and standalone calls do not acquire each other\'s bindings or locals'() {
    const first = new Evaluator({ scope: { evaluator_label: 'first' } })
    const second = new Evaluator({ scope: { evaluator_label: 'second' } })
    assert.equal(first.evaluate('evaluator_label = "changed"; return evaluator_label'), 'changed')
    assert.equal(first.evaluate('return evaluator_label'), 'first')
    assert.equal(second.evaluate('return evaluator_label'), 'second')
    assert.equal(evaluate('return typeof evaluator_label'), 'undefined')
    assert.equal(new Evaluator().evaluate('return typeof evaluator_label'), 'undefined')
    first.evaluate('const evaluator_local = 42')
    assert.equal(first.evaluate('return typeof evaluator_local'), 'undefined')
  },

  'construction snapshots bindings while retaining supplied object identities'() {
    const data = { value: 1 }
    const scope = { color: 'navy', data }
    const evaluator = new Evaluator({ scope })
    scope.color = 'red'
    scope.data = { value: 2 }
    assert.equal(evaluator.evaluate('return color'), 'navy')
    assert.equal(evaluator.evaluate('return data'), data)
    data.value = 3
    assert.equal(evaluator.evaluate('return data.value'), 3)
  },

  'preludes share evaluator bindings and retain closures only through explicit reuse'() {
    const evaluator = new Evaluator({ scope: { Label: Text, title: 'Default' } })
    const scope = evaluator.evaluate_prelude(`
      let counter = 0
      function Badge() {
        return <Label>{title}{++counter}</Label>
      }
    `, { scope: { title: 'Shared' } })
    assert.deepEqual(evaluator.evaluate('<Badge />', { scope }).props.children, ['Shared', 1])
    assert.deepEqual(evaluator.evaluate('<Badge />', { scope }).props.children, ['Shared', 2])
    assert.equal(evaluator.evaluate('return title'), 'Default')
    assert.equal(evaluator.evaluate('return typeof Badge'), 'undefined')
    assert.equal(evaluator.evaluate('return typeof counter'), 'undefined')
    assert.equal(evaluate('return typeof Badge'), 'undefined')
    assert.deepEqual(evaluator.evaluate_prelude(''), {})
  },

  'each evaluation and prelude starts a fresh stream with the selected seed'() {
    const evaluator = new Evaluator({ seed: 7 })
    const draws = '[random(), normal(), normal(), uniform(-2, 2), integer(10)]'
    const code = `return ${draws}`
    const expected = evaluate(code, { seed: 7 })
    assert.deepEqual(evaluator.evaluate(code), expected)
    assert.deepEqual(evaluator.evaluate(code, { seed: 0 }), evaluate(code, { seed: 0 }))
    assert.notDeepEqual(evaluator.evaluate(code, { seed: 0 }), expected)
    evaluator.evaluate('setSeed(1); random(); normal()')
    assert.deepEqual(evaluator.evaluate(code, { seed: undefined }), expected)
    assert.deepEqual(evaluator.evaluate_prelude(`const draws = ${draws}`), { draws: expected })
    assert.deepEqual(evaluator.evaluate_prelude(`const draws = ${draws}`, { seed: 0 }),
      { draws: evaluate(code, { seed: 0 }) })
    assert.deepEqual(evaluator.evaluate(code), expected)
  },

  'configured and per-call random helpers take precedence over the fresh stream'() {
    const evaluator = new Evaluator({ scope: { random: () => 0.25 } })
    assert.equal(evaluator.evaluate('return random()'), 0.25)
    assert.equal(evaluator.evaluate('return random()', { scope: { random: () => 0.5 } }), 0.5)
    assert.deepEqual(evaluator.evaluate_prelude('const value = random()'), { value: 0.25 })
  },

  'source names use evaluator defaults and per-call overrides with mapped errors'() {
    for (const method of ['evaluate', 'evaluate_prelude'] as const) {
      for (const [evaluator, options, name] of [
        [new Evaluator(), {}, method === 'evaluate' ? 'gum.jsx' : 'prelude.jsx'],
        [new Evaluator({ name: 'host.jsx' }), {}, 'host.jsx'],
        [new Evaluator({ name: 'host.jsx' }), { name: 'figure.jsx' }, 'figure.jsx'],
        [new Evaluator({ name: 'host.jsx' }), { name: undefined }, 'host.jsx'],
      ] as const) {
        assert.throws(() => evaluator[method]('const x = 1\nthrow new Error("failed")', options), error => {
          assert.ok(error instanceof ErrorRuntime)
          assert.equal(error.line, 2)
          assert.ok(error.cause instanceof Error)
          assert.ok(error.cause.stack?.includes(name), error.cause.stack)
          return true
        })
      }
    }
  },
}

for (const [name, test] of Object.entries(tests)) {
  test()
  console.log(`ok - ${name}`)
}
console.log(`${Object.keys(tests).length} evaluator checks passed.`)
