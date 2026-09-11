import type { Insets, Point, Rect, Size } from './geometry';

// Affine [a, b, c, d, e, f]: x' = ax + cy + e; y' = bx + dy + f.
type Transform = readonly [number, number, number, number, number, number];
type Guides = Readonly<Partial<Record<string, number>>>;

// All geometry is local to this fragment. A renderer never performs layout.
// Drawing records become concrete with the SVG implementation in stage 2.
interface Fragment<Draw = unknown> {
  readonly size: Size;
  readonly guides: Guides;
  readonly ink: Rect | null;
  readonly overflow: Insets;
  readonly draw: readonly Draw[];
  readonly children: readonly Placement<Draw>[];
}

// A parent owns placement; the same child fragment can have many placements.
interface Placement<Draw = unknown> {
  readonly fragment: Fragment<Draw>;
  readonly offset: Point;
  readonly transform?: Transform;
}

// Guides (including baseline) use pixels from the local origin. Ink describes
// painted bounds after clipping; overflow records excess content before clipping.
// An explicit transform acts in child coordinates, before the placement offset.
export type { Transform, Guides, Fragment, Placement };
