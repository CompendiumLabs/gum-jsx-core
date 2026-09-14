import assert from 'node:assert/strict'
import * as core from '../src/index'
import * as math from '../src/lib/math'
import * as arrays from '../src/lib/arrays'
import * as vectors from '../src/lib/vectors'
import * as colors from '../src/lib/colors'
import {
  range, linspace, repeat, enumerate, zip, meshgrid, lingrid, reshape, split, concat, slice,
  sum, prod, mean, min, max, minimum, maximum, cumsum, norm, normalize,
  clamp, rescale, lerp, sigmoid, logit, smoothstep, rounder, sin, pi, tau,
  add2, sub2, mul2, div2, addn, subn, muln, divn, polar, polard,
  addc, subc, mulc, divc, conjc, normc, argc, interp, palette,
  RNG, setSeed, random, evaluate, LayoutPass, render_svg, make_request, exact,
} from '../src/index'

function near(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`)
}

const tests: Record<string, () => void> = {
  'math helpers share their public definitions with JSX and allow scope overrides'() {
    const expected = { ...math, ...arrays, ...vectors, ...colors, RNG }
    for (const [name, value] of Object.entries(expected)) assert.equal(core[name as keyof typeof core], value, name)
    const code = `<Text>{${Object.keys(expected).map(name => `${name} === expected.${name}`).join(' && ') } ? 'yes' : 'no'}</Text>`
    assert.equal(new LayoutPass().layout(evaluate(code, { scope: { expected } })).label, 'yes')
    const custom = evaluate('<Text>{sin(pi)}</Text>', { scope: { sin: () => 7 } })
    assert.equal(new LayoutPass().layout(custom).label, '7')
    assert.equal(math.isFinite('1' as any), false)
    assert.equal(math.isInf(NaN), false)
    assert.equal(math.isInf(-Infinity), true)
    assert.equal(math.isNan(NaN), true)
    near(math.asin(sin(0.5)), 0.5)
    near(math.log1p(math.expm1(0.01)), 0.01)
    assert.equal(tau, 2 * pi)
  },

  'range excludes the stop for positive, fractional, and negative steps'() {
    assert.deepEqual(range(4), [0, 1, 2, 3])
    assert.deepEqual(range(1, 6, 2), [1, 3, 5])
    assert.deepEqual(range(5, -1, -2), [5, 3, 1])
    assert.deepEqual(range(0, 0.3, 0.1), [0, 0.1, 0.2])
    assert.deepEqual(range(2, -2, -0.5), [2, 1.5, 1, 0.5, 0, -0.5, -1, -1.5])
    const large = range(-1e308, 1.7e308, 9e307)
    assert.equal(large.length, 3)
    near(large[2] / 1e307, 8)
    for (const values of [range(0), range(-2), range(3, 1), range(1, 3, -1), range(2, 2)]) {
      assert.deepEqual(values, [])
      assert.ok(Object.isFrozen(values))
    }
  },

  'sequence generators reject invalid or excessive allocations before looping'() {
    for (const step of [0, NaN, Infinity]) assert.throws(() => range(0, 2, step), RangeError)
    assert.throws(() => range(Infinity), RangeError)
    assert.throws(() => range(100001), /range length/)
    assert.throws(() => range(0, 1, Number.MIN_VALUE), /range length/)
    assert.throws(() => range(1e20, 1e20 + 65536, 1), /too small to advance/)
    for (const count of [-1, 1.5, Infinity, NaN, 100001]) {
      assert.throws(() => linspace(0, 1, count), /count/)
      assert.throws(() => repeat(0, count), /count/)
    }
    assert.throws(() => lingrid([0, 1], [0, 1], 1000), /grid size/)
    assert.throws(() => meshgrid(range(500), range(500)), /meshgrid size/)
  },

  'linspace preserves inclusive defaults and can omit a periodic endpoint'() {
    assert.deepEqual(linspace(2, 8, 4), [2, 4, 6, 8])
    assert.deepEqual(linspace(8, 2, 4), [8, 6, 4, 2])
    assert.deepEqual(linspace(2, 8, 3, false), [2, 4, 6])
    assert.deepEqual(linspace(2, 8, 0), [])
    assert.deepEqual(linspace(2, 8, 1), [2])
    assert.equal(linspace(0, 1).length, 101)
    assert.deepEqual(linspace(-1e308, 1e308, 3), [-1e308, 0, 1e308])
    assert.ok(Object.isFrozen(linspace(0, 1)))
    assert.throws(() => linspace(0, Infinity), /finite/)
  },

  'array pairing and grids preserve order, own output rows, and keep input objects intact'() {
    const values = [2, 4, 6]
    assert.deepEqual(enumerate(values), [[0, 2], [1, 4], [2, 6]])
    const rows = zip(values, ['a', 'b'])
    assert.deepEqual(rows, [[2, 'a'], [4, 'b']])
    assert.deepEqual(zip(), [])
    assert.ok(Object.isFrozen(rows) && Object.isFrozen(rows[0]))
    assert.deepEqual(meshgrid([1, 2], ['a', 'b']), [[1, 'a'], [1, 'b'], [2, 'a'], [2, 'b']])
    const grid = lingrid([1, 2], [4, 0], { x: 2, y: 3 })
    assert.deepEqual(grid, [{ x: 1, y: 4 }, { x: 1, y: 2 }, { x: 1, y: 0 },
      { x: 2, y: 4 }, { x: 2, y: 2 }, { x: 2, y: 0 }])
    assert.deepEqual(lingrid([0, 1], [0, 1], [0, 3]), [])
    assert.ok(Object.isFrozen(grid[0]))
    const item = { x: 2 }, copies = repeat(item, 3)
    assert.equal(copies[0], item)
    assert.ok(!Object.isFrozen(item) && !Object.isFrozen(values))
  },

  'reshape, chunks, concatenation, and stepped slices preserve the intended data'() {
    const values = range(6), matrix = reshape(values, [2, 3])
    assert.deepEqual(matrix, [[0, 1, 2], [3, 4, 5]])
    assert.deepEqual(concat(matrix), values)
    assert.ok(Object.isFrozen(matrix[0]))
    assert.deepEqual(split(values, 4), [[0, 1, 2, 3], [4, 5]])
    assert.deepEqual(slice(values, 1, 6, 2), [1, 3, 5])
    assert.deepEqual(slice(values, -4, -1), [2, 3, 4])
    assert.deepEqual(slice(values, undefined, undefined, -2), [5, 3, 1])
    assert.deepEqual(slice(values, 100, -100, -1), [5, 4, 3, 2, 1, 0])
    assert.deepEqual(slice([], undefined, undefined, -1), [])
    assert.throws(() => reshape(values, [2, 2]), /match/)
    assert.throws(() => split(values, 0), /positive/)
    assert.throws(() => slice(values, 0, 6, 0), /nonzero/)
    assert.throws(() => slice(values, 0.5), /integer/)
  },

  'reductions handle missing values, empty input, cumulative bases, and nonfinite data'() {
    const values = [1, undefined, 3, null, 5]
    assert.equal(sum(values), 9); assert.equal(prod(values), 15); assert.equal(mean(values), 3)
    assert.equal(min(values), 1); assert.equal(max(values), 5)
    assert.equal(minimum(...values), 1); assert.equal(maximum(...values), 5)
    assert.equal(sum([]), 0); assert.equal(prod([]), 1)
    assert.equal(min([]), undefined); assert.equal(max([]), undefined); assert.ok(Number.isNaN(mean([])))
    assert.deepEqual(cumsum([2, -1, 4]), [0, 2, 1, 5])
    assert.deepEqual(cumsum([2, -1, 4], false), [2, 1, 5])
    assert.ok(Number.isNaN(sum([1, NaN])) && Number.isNaN(max([1, NaN])))
    assert.equal(math.all([]), true); assert.equal(math.any([]), false)
  },

  'vector norms handle signs, zero vectors, and large magnitudes'() {
    assert.equal(norm([-3, 4]), 5)
    assert.equal(norm([-3, 4], 1), 7); assert.equal(norm([-3, 4], Infinity), 4)
    assert.equal(norm([]), 0); assert.equal(norm([0, 0]), 0)
    near(norm([-3e300, 4e300]) / 1e300, 5)
    near(normalize([3, 4], 2)[0], 0.6)
    near(sum(normalize([2, 3, 5])), 1)
    near(norm(normalize([1e308, -1e308], 2)), 1)
    assert.deepEqual(normalize([0, 0]), [0, 0])
    assert.throws(() => norm([1], 0), /positive/)
    assert.throws(() => normalize([1], NaN), /positive/)
  },

  'mapping helpers support reversed domains, interpolation, and compact labels'() {
    assert.equal(clamp(3), 1); assert.equal(clamp(-3, [2, -2]), -2)
    assert.equal(rescale(3, [2, 6]), 0.25); assert.equal(rescale(3, [6, 2]), 0.75)
    assert.equal(rescale(0, [-1e308, 1e308]), 0.5)
    assert.equal(rescale(1e308, [-1e308, 0]), 2)
    assert.equal(lerp(-1e308, 1e308, 0.5), 0)
    assert.equal(lerp(2, 4, 2), 6)
    assert.equal(smoothstep(-1), 0); assert.equal(smoothstep(2), 1)
    assert.equal(smoothstep(3, [6, 0]), 0.5); near(logit(sigmoid(0.75)), 0.75)
    assert.equal(rounder(1.25, 4), '1.25'); assert.equal(rounder(-0.001, 2), '0')
    assert.equal(rounder('12.500px'), '12.5px'); assert.equal(rounder('label'), 'label')
    assert.throws(() => rescale(1, [2, 2]), /differ/)
    assert.throws(() => rounder(2, -1), /precision/)
  },

  'polar and vector arithmetic feed native graphics points and reject mismatched dimensions'() {
    assert.deepEqual(add2([1, 2], 3), { x: 4, y: 5 })
    assert.deepEqual(sub2({ x: 3, y: 4 }, [2, 6]), { x: 1, y: -2 })
    assert.deepEqual(mul2([1, 2], [3, 4]), { x: 3, y: 8 })
    assert.deepEqual(div2([4, 6], 2), { x: 2, y: 3 })
    assert.deepEqual(addn([1, 2, 3], [3, 2, 1]), [4, 4, 4])
    assert.deepEqual(subn([1, 2], [3, 4]), [-2, -2])
    assert.deepEqual(muln([1, 2], [3, 4]), [3, 8])
    assert.deepEqual(divn([4, 6], [2, 3]), [2, 2])
    assert.throws(() => addn([1], [1, 2]), /match/)
    const point = polar(pi / 2, [2, 3], { x: 4, y: 5 })
    near(point.x, 4); near(point.y, 8)
    assert.deepEqual(polard(90, [2, 3], [4, 5]), point)
    assert.ok(Object.isFrozen(point))
  },

  'complex arithmetic uses a squared divisor magnitude and supports real scalars'() {
    assert.deepEqual(addc([2, 3], 4), [6, 3])
    assert.deepEqual(subc([2, 3], [1, 4]), [1, -1])
    assert.deepEqual(mulc([1, 2], [3, 4]), [-5, 10])
    const quotient = divc([3, 4], [1, 2])
    near(quotient[0], 2.2); near(quotient[1], -0.4)
    const back = mulc(quotient, [1, 2]); near(back[0], 3); near(back[1], 4)
    assert.deepEqual(divc([1e300, 1e300], [1e300, 1e300]), [1, 0])
    assert.deepEqual(conjc([3, 4]), [3, -4]); assert.equal(normc([3, 4]), 5)
    near(argc([0, 1]), pi / 2)
  },

  'color interpolation handles alpha, clamps endpoints, and snapshots palette limits'() {
    assert.equal(interp('#000', '#fff', 0.5), 'rgba(128, 128, 128, 1)')
    assert.equal(interp('#0000', '#ffffff80', 1), `rgba(255, 255, 255, ${128 / 255})`)
    assert.equal(interp('#000', '#fff', -1), 'rgba(0, 0, 0, 1)')
    const limits: [number, number] = [10, 0], paint = palette('#000', '#fff', limits)
    limits[0] = 100
    assert.equal(paint(5), 'rgba(128, 128, 128, 1)')
    assert.equal(paint(-1), 'rgba(255, 255, 255, 1)')
    assert.throws(() => interp('blue', '#fff', 0.5), /color interpolation/)
    assert.throws(() => palette('#000', '#fff', [0, 0]), /differ/)
  },

  'seeded random streams reset cached normals and keep integer bounds exclusive'() {
    const rng = new RNG(42), same = new RNG(42)
    assert.deepEqual(range(10).map(rng.random), range(10).map(same.random))
    const first = new RNG(12).normal()
    rng.setSeed(12); rng.normal(); rng.setSeed(12); assert.equal(rng.normal(), first)
    const draws = range(2000).map(() => rng.integer(-2, 3))
    assert.deepEqual([...new Set(draws)].sort(), [-1, -2, 0, 1, 2])
    assert.equal(rng.integer(1), 0); assert.equal(rng.normal(4, 0), 4)
    const normals = range(8192).map(() => rng.normal(2, 3))
    near(mean(normals), 2, 0.12)
    near(mean(normals.map(x => (x - 2) ** 2)), 9, 0.5)
    for (const value of range(100).map(() => rng.uniform(-2, 5))) assert.ok(value >= -2 && value < 5)
    assert.throws(() => new RNG(NaN), /seed/)
    assert.throws(() => rng.normal(0, -1), /nonnegative/)
    assert.throws(() => rng.integer(0), /exceed/)
    assert.throws(() => rng.uniform(0, Infinity), /finite/)
  },

  'each JSX evaluation has an independent seeded stream and resizing reuses its samples'() {
    const code = 'return <Plot><Points points={range(6).map(x => ({x, y: normal()}))}/></Plot>;'
    const a = evaluate(code), b = evaluate(code), c = evaluate(code, { seed: 7 })
    assert.deepEqual(a.props, b.props); assert.notDeepEqual(a.props, c.props)
    assert.deepEqual(evaluate('setSeed(7); ' + code).props, c.props)
    const pass = new LayoutPass(), before = JSON.stringify(a)
    pass.layout(a); pass.layout(a, make_request({ width: exact(600) }))
    assert.equal(JSON.stringify(a), before)
    setSeed(15); const expected = random(); setSeed(15); evaluate(code)
    assert.equal(random(), expected)
    const overridden = evaluate('<Text>{random()}</Text>', { scope: { random: () => 0.25 } })
    assert.equal(pass.layout(overridden).label, '0.25')
  },

  'bare math functions and generated sample arrays render domain gaps in JSX'() {
    const root = evaluate('<Plot><SymLine fy={sqrt} xvals={range(-2, 3)}/></Plot>')
    const svg = render_svg(new LayoutPass().layout(root))
    assert.ok(svg.includes('<path'))
    assert.ok(!/NaN|Infinity/.test(svg))
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} math/utility checks passed.`)
