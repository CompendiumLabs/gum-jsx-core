import { finite, nonnegative } from './checks';
import { resolve_length } from './units';
import type { Length, LengthContext } from './units';

// Inputs may use tuples; geometry results always retain named coordinates.
type PointValue<T = number> = Readonly<{ x: T; y: T }> | readonly [x: T, y: T];
// These records contain resolved pixels, never source length values.
type Point = Readonly<{ x: number; y: number }>;
type Size = Readonly<{ width: number; height: number }>;
type Rect = Readonly<Point & Size>;
type Clip = Readonly<Rect & { radius?: Point }>;
type Transform = readonly [number, number, number, number, number, number];
type Insets = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;
type InsetSides = Readonly<Partial<Record<keyof Insets | 't' | 'b' | 'l' | 'r' | 'h' | 'v', Length>>>;
// Tuple order follows Gum's horizontal/vertical and top/bottom/left/right forms.
type InsetSpec = Length | InsetSides
  | readonly [h: Length, v: Length]
  | readonly [t: Length, b: Length, l: Length, r: Length];

// Read the representation independently of units and finiteness. Plotting callers
// must be able to preserve nonfinite samples as gaps until they build paths.
function read_point<T>(value: PointValue<T>, name = 'point'): Readonly<{ x: T; y: T }> {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length === 2 && 0 in value && 1 in value) {
        return Object.freeze({ x: value[0], y: value[1] });
      }
    } else if ('x' in value && 'y' in value) {
      return Object.freeze({ x: value.x, y: value.y });
    }
  }
  throw new TypeError(`${name} needs {x, y} or [x, y] with exactly two coordinates`);
}

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

// Combine independently resolved layers, such as border and padding.
function add_insets(a: Insets, b: Insets): Insets {
  return make_insets({
    left: a.left + b.left, top: a.top + b.top,
    right: a.right + b.right, bottom: a.bottom + b.bottom,
  });
}

// Clips retain optional rounded corners; rectangular callers need no extra data.
function make_clip(rect: Rect, radius?: PointValue): Clip {
  const bounds = make_rect(rect.x, rect.y, rect.width, rect.height);
  if (radius === undefined) return bounds;
  const pair = read_point(radius, 'radius');
  const x = Math.min(nonnegative(pair.x, 'radius.x'), rect.width / 2);
  const y = Math.min(nonnegative(pair.y, 'radius.y'), rect.height / 2);
  return Object.freeze({ ...bounds, radius: make_point(x, y) });
}

// Horizontal fractions use containing width; vertical fractions use height.
function resolve_insets(
  spec: InsetSpec = 0,
  context: LengthContext = {},
  property = 'padding',
): Insets {
  const { font_size, reference = {}, path = 'root' } = context;
  if (typeof spec !== 'number' && (spec === null || typeof spec !== 'object')) {
    throw new TypeError(`${path}.${property}: expected a length, side object, [h, v], or [t, b, l, r]`);
  }
  let sides: InsetSides;
  if (typeof spec === 'number' || 'unit' in spec) {
    sides = { left: spec, top: spec, right: spec, bottom: spec };
  } else if (Array.isArray(spec)) {
    if ((spec.length !== 2 && spec.length !== 4) || [...spec].some(value => value == null)) {
      throw new TypeError(`${path}.${property}: arrays need exactly two [h, v] or four [t, b, l, r] lengths`);
    }
    sides = spec.length === 2 ? { h: spec[0], v: spec[1] }
      : { t: spec[0], b: spec[1], l: spec[2], r: spec[3] };
  } else {
    sides = spec as InsetSides;
  }

  function resolve_side(side: keyof Insets, length: Length | undefined, fraction?: number): number {
    const location = `${path}.${property}.${side}`;
    const basis = { font_size, fraction };
    return nonnegative(resolve_length(length ?? 0, basis, location), location);
  }

  // Full names win over short names; individual sides win over axis defaults.
  return make_insets({
    left: resolve_side('left', sides.left ?? sides.l ?? sides.h, reference.width),
    top: resolve_side('top', sides.top ?? sides.t ?? sides.v, reference.height),
    right: resolve_side('right', sides.right ?? sides.r ?? sides.h, reference.width),
    bottom: resolve_side('bottom', sides.bottom ?? sides.b ?? sides.v, reference.height),
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

// Union nullable bounds, preserving the difference between no paint and zero size.
function union_rects(...rects: readonly (Rect | null)[]): Rect | null {
  const items = rects.filter((rect): rect is Rect => rect !== null);
  if (items.length === 0) return null;
  const x = Math.min(...items.map(rect => rect.x));
  const y = Math.min(...items.map(rect => rect.y));
  const right = Math.max(...items.map(rect => rect.x + rect.width));
  const bottom = Math.max(...items.map(rect => rect.y + rect.height));
  return make_rect(x, y, right - x, bottom - y);
}

// A clip with no overlapping area leaves no visible ink.
function intersect_rects(a: Rect | null, b: Rect): Rect | null {
  if (a === null) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right <= x || bottom <= y ? null : make_rect(x, y, right - x, bottom - y);
}

// Own a finite affine matrix: x' = ax + cy + e; y' = bx + dy + f.
function make_transform(values: Transform): Transform {
  if (values.length !== 6) throw new TypeError('An affine transform needs six values');
  values.forEach(value => finite(value, 'transform'));
  return Object.freeze([...values]) as Transform;
}

// Transform in child coordinates, then add the parent's placement offset.
function transform_rect(rect: Rect | null, offset: PointValue, transform?: Transform): Rect | null {
  if (rect === null) return null;
  const translation = read_point(offset, 'offset');
  const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 1, 0, 0];
  const { x, y, width, height } = rect;
  const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]];
  const points = corners.map(([x, y]) => make_point(
    a * x + c * y + e + translation.x,
    b * x + d * y + f + translation.y,
  ));
  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x));
  const bottom = Math.max(...points.map(point => point.y));
  return make_rect(left, top, right - left, bottom - top);
}

export {
  read_point, make_size, make_point, make_rect, make_clip, make_insets, add_insets, resolve_insets,
  deflate_size, inflate_size, bounds_overflow,
  union_rects, intersect_rects, make_transform, transform_rect,
};
export type { Point, PointValue, Size, Rect, Clip, Transform, Insets, InsetSpec };
