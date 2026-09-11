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

export { finite, nonnegative };
