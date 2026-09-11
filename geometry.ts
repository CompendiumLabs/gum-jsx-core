import { finite, nonnegative } from './checks';
import { resolve_length } from './units';
import type { Length, LengthContext } from './units';

// These records contain resolved pixels, never source length values.
type Point = Readonly<{ x: number; y: number }>;
type Size = Readonly<{ width: number; height: number }>;
type Rect = Readonly<Point & Size>;
type Insets = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;
type InsetSpec = Length | Readonly<Partial<Record<keyof Insets, Length>>>;

// Constructors own and freeze their records; no layout dimension is infinite.
function make_size(width = 0, height = 0): Size {
  nonnegative(width, 'width');
  nonnegative(height, 'height');
  return Object.freeze({ width, height });
}

// An offset can lie outside the allocated box.
function make_point(x = 0, y = 0): Point {
  finite(x, 'x');
  finite(y, 'y');
  return Object.freeze({ x, y });
}

// Combine a local origin with a finite, nonnegative extent.
function make_rect(x: number, y: number, width: number, height: number): Rect {
  return Object.freeze({ ...make_point(x, y), ...make_size(width, height) });
}

// Missing named sides contribute no space.
function make_insets(sides: Partial<Insets> = {}): Insets {
  const { left = 0, top = 0, right = 0, bottom = 0 } = sides;
  for (const [side, value] of Object.entries({ left, top, right, bottom })) {
    nonnegative(value, side);
  }
  return Object.freeze({ left, top, right, bottom });
}

// Horizontal fractions use containing width; vertical fractions use height.
function resolve_insets(
  spec: InsetSpec = 0,
  context: LengthContext = {},
  property = 'padding',
): Insets {
  const sides = typeof spec === 'number' || 'unit' in spec
    ? { left: spec, top: spec, right: spec, bottom: spec }
    : spec;
  const { font_size, reference = {}, path = 'root' } = context;

  function resolve_side(side: keyof Insets, fraction?: number): number {
    const location = `${path}.${property}.${side}`;
    const basis = { font_size, fraction };
    return nonnegative(resolve_length(sides[side] ?? 0, basis, location), location);
  }

  return make_insets({
    left: resolve_side('left', reference.width),
    top: resolve_side('top', reference.height),
    right: resolve_side('right', reference.width),
    bottom: resolve_side('bottom', reference.height),
  });
}

// Insets belong to the outer box and cannot create negative inner dimensions.
function deflate_size(size: Size, insets: Insets): Size {
  const { width, height } = size;
  const { left, top, right, bottom } = insets;
  return make_size(
    Math.max(0, width - left - right),
    Math.max(0, height - top - bottom),
  );
}

// Retain the full outer extent, even when the available space is smaller.
function inflate_size(size: Size, insets: Insets): Size {
  const { width, height } = size;
  const { left, top, right, bottom } = insets;
  return make_size(width + left + right, height + top + bottom);
}

// Compare unclipped content bounds with the allocated rectangle at the origin.
function bounds_overflow(size: Size, bounds: Rect | null): Insets {
  if (bounds === null) return make_insets();
  const { x, y, width, height } = bounds;
  return make_insets({
    left: Math.max(0, -x),
    top: Math.max(0, -y),
    right: Math.max(0, x + width - size.width),
    bottom: Math.max(0, y + height - size.height),
  });
}

export {
  make_size, make_point, make_rect, make_insets, resolve_insets,
  deflate_size, inflate_size, bounds_overflow,
};
export type { Point, Size, Rect, Insets, InsetSpec };
