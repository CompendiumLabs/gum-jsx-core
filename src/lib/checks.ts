// Reject invalid geometry at the boundary where a number acquires meaning.
function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${path} must be finite; received ${value}`);
  }
  return value;
}

// Dimensions and resolved spacing cannot be negative; coordinates can be.
function nonnegative(value: number, path: string): number {
  finite(value, path);
  if (value < 0) {
    throw new RangeError(`${path} must be nonnegative; received ${value}`);
  }
  return value;
}

// Bound generated data before allocating it, including products such as grids.
function count_limit(value: number, path: string, max = 100000): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${path} must be an integer from 0 to ${max}`);
  }
  return value;
}

export { finite, nonnegative, count_limit };
