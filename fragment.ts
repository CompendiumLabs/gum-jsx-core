import { finite } from './checks';
import { drawing_ink, copy_drawing } from './drawing';
import type { Drawing } from './drawing';
import {
  make_size, make_point, make_rect, make_insets, make_transform,
  union_rects, intersect_rects, transform_rect, bounds_overflow,
} from './geometry';
import type { Insets, Point, Rect, Size, Transform } from './geometry';

type Guides = Readonly<Partial<Record<string, number>>>;
const OWNED = Symbol('next.fragment');

// All geometry is local to this fragment. A renderer never performs layout.
interface Fragment<Draw = Drawing> {
  readonly name?: string;
  readonly label?: string;
  readonly size: Size;
  readonly guides: Guides;
  readonly ink: Rect | null;
  readonly overflow: Insets;
  readonly draw: readonly Draw[];
  readonly children: readonly Placement<Draw>[];
  readonly clip?: Rect;
}

// A parent owns placement; the same child fragment can have many placements.
interface Placement<Draw = Drawing> {
  readonly fragment: Fragment<Draw>;
  readonly offset: Point;
  readonly transform?: Transform;
}

type FragmentSpec = Readonly<{
  size: Size;
  name?: string;
  label?: string;
  guides?: Guides;
  ink?: Rect | null;
  overflow?: Insets;
  draw?: readonly Drawing[];
  children?: readonly Placement[];
  clip?: Rect;
}>;

// Placing a result preserves its identity and never asks for another measurement.
function place_fragment(
  fragment: Fragment, offset: Point = make_point(), transform?: Transform,
): Placement {
  // Normalize external records once; results made here keep their shared identity.
  const owned = (fragment as Fragment & { [OWNED]?: true })[OWNED];
  return Object.freeze({
    fragment: owned ? fragment : make_fragment(fragment),
    offset: make_point(offset.x, offset.y),
    ...(transform === undefined ? {} : { transform: make_transform(transform) }),
  });
}

// Reconstruct the unclipped extent represented by a fragment's overflow edges.
function content_bounds(fragment: Pick<Fragment, 'size' | 'overflow'>): Rect {
  const { width, height } = fragment.size;
  const { left, top, right, bottom } = fragment.overflow;
  return make_rect(-left, -top, width + left + right, height + top + bottom);
}

// Own drawing and placement data, then aggregate geometry once during layout.
// Overflow uses unclipped content; ink is intersected with this fragment's clip.
function make_fragment(spec: FragmentSpec): Fragment {
  const size = make_size(spec.size.width, spec.size.height);
  const guides = Object.fromEntries(Object.entries(spec.guides ?? {})
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .map(([key, value]) => [key, finite(value, `guide ${key}`)]));
  const draw = (spec.draw ?? []).map(copy_drawing);
  const children = (spec.children ?? []).map(child =>
    place_fragment(child.fragment, child.offset, child.transform));

  // Custom leaves may supply more precise ink; drawing bounds are the default.
  const own_ink = spec.ink === undefined ? union_rects(...draw.map(drawing_ink)) : spec.ink;
  const ink = union_rects(own_ink, ...children.map(child =>
    transform_rect(child.fragment.ink, child.offset, child.transform)));
  const own_bounds = content_bounds({ size, overflow: make_insets(spec.overflow) });
  const bounds = union_rects(own_bounds, ink, ...children.map(child =>
    transform_rect(content_bounds(child.fragment), child.offset, child.transform)));

  const clip = spec.clip === undefined ? undefined
    : make_rect(spec.clip.x, spec.clip.y, spec.clip.width, spec.clip.height);
  const fragment: Fragment = {
    ...(spec.name === undefined ? {} : { name: spec.name }),
    ...(spec.label === undefined ? {} : { label: spec.label }),
    size, guides: Object.freeze(guides),
    ink: clip === undefined ? ink : intersect_rects(ink, clip),
    overflow: bounds_overflow(size, bounds),
    draw: Object.freeze(draw), children: Object.freeze(children),
    ...(clip === undefined ? {} : { clip }),
  };
  Object.defineProperty(fragment, OWNED, { value: true });
  return Object.freeze(fragment);
}

// Guides (including baseline) use pixels from the local origin. Ink describes
// painted bounds after clipping; overflow records excess content before clipping.
// An explicit transform acts in child coordinates, before the placement offset.
export { make_fragment, place_fragment, content_bounds };
export type { Transform, Guides, Fragment, Placement, FragmentSpec };
