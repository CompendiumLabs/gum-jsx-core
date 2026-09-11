import assert from 'node:assert/strict';
import { distribute_flex } from '../src/index';
import type { FlexItem } from '../src/index';

// Build a resolved item; these numbers are pixels and dimensionless weights.
function item(props: Partial<FlexItem> = {}): FlexItem {
  return Object.freeze({ basis: 0, min: 0, max: Infinity, grow: 0, shrink: 0, ...props });
}

const tests: Record<string, () => void> = {
  'natural flex bases clamp independently and zero weights reserve their sizes'() {
    const items = Object.freeze([item({ basis: 10, min: 20 }), item({ basis: 50, max: 30 })]);
    const source = JSON.stringify(items);
    for (const budget of [undefined, 0, 100]) {
      const sizes = distribute_flex(items, budget);
      assert.deepEqual(sizes, [20, 30]);
      assert.ok(Object.isFrozen(sizes));
    }
    assert.equal(JSON.stringify(items), source);
    assert.deepEqual(distribute_flex([], 100), []);
  },

  'growth uses weights and shrinking weights each original basis'() {
    assert.deepEqual(distribute_flex([
      item({ basis: 20, grow: 1 }), item({ basis: 10, grow: 3 }),
    ], 100), [37.5, 62.5]);
    assert.deepEqual(distribute_flex([
      item({ basis: 100, shrink: 1 }), item({ basis: 200, shrink: 1 }),
    ], 150), [50, 100]);
    assert.deepEqual(distribute_flex([
      item({ basis: 100, shrink: 2 }), item({ basis: 200, shrink: 1 }),
    ], 150), [25, 125]);
    assert.deepEqual(distribute_flex([
      item({ basis: 40 }), item({ basis: 0, grow: 1 }),
    ], 100), [40, 60]);
  },

  'opposing clamp violations retain clamped results and redistribute only the frozen side'() {
    const pair = [item({ grow: 1, min: 7, max: 9 }), item({ grow: 1, max: 3 })];
    assert.deepEqual(distribute_flex(pair, 10), [7, 3]);
    assert.deepEqual(distribute_flex(pair, 11), [8, 3]);
    assert.deepEqual(distribute_flex(pair, 20), [9, 3]);
    assert.deepEqual(distribute_flex([
      item({ grow: 1, min: 70, max: 95 }), item({ grow: 1, max: 40 }),
    ], 100), [70, 30]);
    assert.deepEqual(distribute_flex([
      item({ basis: 100, shrink: 1, min: 80 }), item({ basis: 100, shrink: 1, min: 40 }),
    ], 60), [80, 40]);
  },

  'extreme finite weights survive product overflow and renormalize after clamps'() {
    assert.deepEqual(distribute_flex([item({ grow: 1 }), item({ grow: 1 })], 0), [0, 0]);
    assert.deepEqual(distribute_flex([item({ grow: 1e308 }), item({ grow: 1e308 })], 100), [50, 50]);
    assert.deepEqual(distribute_flex([
      item({ basis: 1e307, shrink: 1e308 }), item({ basis: 1e307, shrink: 1e308 }),
    ], 1e307), [5e306, 5e306]);
    assert.deepEqual(distribute_flex([item({ basis: 0, min: 10, shrink: 1 })], 0), [10]);
    assert.deepEqual(distribute_flex([
      item({ grow: 1e308, max: 1 }), item({ grow: 1e-308 }),
    ], 2), [1, 1]);
    assert.deepEqual(distribute_flex([
      item({ basis: 1e300, shrink: 1e-300 }), item({ basis: 1e-300, shrink: 1e300 }),
    ], 5e299), [5e299, 0]);
    assert.deepEqual(distribute_flex([
      item({ basis: 1e-200, shrink: 1e-200 }), item({ basis: 1e-200, shrink: 1e-200 }),
    ], 1e-200), [5e-201, 5e-201]);
  },

  'bounded allocations conserve feasible budgets across mixed limits'() {
    let seed = 104729;
    const random = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    for (let trial = 0; trial < 200; trial++) {
      const items = Array.from({ length: 1 + random(8) }, () => {
        const min = random(40);
        return item({ basis: random(120), min, max: min + random(50),
          grow: 1 + random(3), shrink: 1 + random(3) });
      });
      const budget = random(400);
      const sizes = distribute_flex(items, budget);
      const min = items.reduce((sum, item) => sum + item.min, 0);
      const max = items.reduce((sum, item) => sum + item.max, 0);
      sizes.forEach((size, index) => {
        assert.ok(Number.isFinite(size));
        assert.ok(size >= items[index].min && size <= items[index].max);
      });
      const expected = Math.max(min, Math.min(max, budget));
      assert.ok(Math.abs(sizes.reduce((sum, size) => sum + size, 0) - expected) < 1e-9);
    }
  },

  'invalid flex inputs fail before allocation'() {
    for (const props of [{ basis: -1 }, { grow: -1 }, { shrink: Infinity }, { min: 20, max: 10 }]) {
      assert.throws(() => distribute_flex([item(props)], 100), RangeError);
    }
    assert.throws(() => distribute_flex([], Infinity), RangeError);
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} flex checks passed.`);
