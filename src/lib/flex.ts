import { finite, nonnegative } from './checks';
import type { Length } from '../engine/units';

// These source properties are interpreted by the immediate stack parent.
type FlexSpec = Readonly<{ basis?: Length; grow?: number; shrink?: number }>;
type FlexItem = Readonly<{
  basis: number;
  min: number;
  max: number;
  grow: number;
  shrink: number;
}>;

// Clamp an allocation without mutating the item's original basis.
function clamp(value: number, item: FlexItem): number {
  return Math.max(item.min, Math.min(item.max, value));
}

// Normalize only the remaining participants. A tiny weight can become significant
// once a larger neighbor freezes. Logs handle shrink products outside numeric range.
function flex_weights(items: readonly FlexItem[], active: readonly number[], grow: boolean) {
  const weights = active.map(index => grow ? items[index].grow : items[index].shrink * items[index].basis);
  const largest = Math.max(...weights);
  if (largest > 0 && Number.isFinite(largest)) return weights.map(weight => weight / largest);
  const logs = active.map(index => Math.log(items[index].shrink) + Math.log(items[index].basis));
  const peak = Math.max(...logs);
  return logs.map(weight => Math.exp(weight - peak));
}

// Distribute a finite budget around the original bases. Growth weights are grow;
// shrink weights are shrink × basis. Zero weights keep their clamped basis.
//
// Clamping a trial can produce opposing violations. Freeze only the side whose
// corrections dominate, then redistribute around the remaining original bases.
// If corrections cancel, keep the clamped values. Each unsuccessful round freezes
// at least one item, so the loop is bounded by the number of children.
function distribute_flex(items: readonly FlexItem[], budget?: number): readonly number[] {
  if (budget !== undefined) nonnegative(budget, 'flex budget');
  for (const item of items) {
    nonnegative(item.basis, 'flex basis');
    nonnegative(item.min, 'flex minimum');
    if (item.max !== Infinity) nonnegative(item.max, 'flex maximum');
    if (item.min > item.max) throw new RangeError('Flex minimum exceeds maximum');
    nonnegative(item.grow, 'grow');
    nonnegative(item.shrink, 'shrink');
  }
  const sizes = items.map(item => clamp(item.basis, item));
  const total = finite(sizes.reduce((sum, size) => sum + size, 0), 'flex total');
  if (budget === undefined || budget === total) return Object.freeze(sizes);

  const grow = budget > total;
  let active = items.map((_, index) => index).filter(index => {
    const item = items[index];
    return item.min < item.max && (grow ? item.grow > 0 : item.shrink > 0 && item.basis > 0);
  });

  while (active.length) {
    const selected = new Set(active);
    const fixed = sizes.reduce((sum, size, index) => sum + (selected.has(index) ? 0 : size), 0);
    const base = active.reduce((sum, index) => sum + items[index].basis, 0);
    const free = finite(budget - fixed - base, 'flex free space');
    const weights = flex_weights(items, active, grow);
    const weight = weights.reduce((sum, value) => sum + value, 0);
    const violations = active.map((index, slot) => {
      const trial = finite(items[index].basis + free * (weights[slot] / weight), 'flex allocation');
      sizes[index] = clamp(trial, items[index]);
      return sizes[index] - trial;
    });
    const correction = violations.reduce((sum, value) => sum + value, 0);
    if (correction === 0) break;
    active = active.filter((_, index) => correction > 0
      ? violations[index] <= 0 : violations[index] >= 0);
  }
  return Object.freeze(sizes);
}

export { distribute_flex };
export type { FlexSpec, FlexItem };
