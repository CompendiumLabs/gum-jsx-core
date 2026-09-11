# Next core: stage 1

This directory implements the unit and layout contracts for the fresh core. Import
the experimental API from `@gum-jsx/core/next`. The executable examples currently
produce values and fragment trees; elements, JSX, SVG, and a render command begin
in stage 2.

From `gum-jsx-core`:

```sh
bun run test:next
bun run probe:next
bun run probe:next hugging_box
bun run typecheck
```

The [contract gallery](../../examples/next/contracts.ts) contains six probes:

| Probe | Expected result |
|---|---|
| `units` | With a 16px font and 640px reference, `px(10)`, `em(2)`, and `0.5` resolve to 10, 32, and 320 pixels. |
| `fixed_viewport` | Explicit pixel dimensions produce a 640×360 exact request. |
| `half_width` | A half-width child prefers 320px across different trial offers; an exact 80px allocation wins. |
| `hugging_box` | A measured 96×20 line plus 8px padding produces 112×36, with its baseline shifted by 8px. |
| `oversized_padding` | A 10×8 allocation with 8px padding gives its empty child 0×0 and records right/bottom overflow of 6/8px. |
| `shape_defaults` | A natural aspect-2 shape is 32×16; two exact dimensions can override that aspect. An empty container is 0×0. |

The text line is a measurement fixture, not a font measurement or a Text element.
Both box probes use unpainted fragments, so their ink is `null` even when their
layout content overflows.

## Lengths and references

Length properties accept fractions as raw numbers and explicit `em()` / `px()`
values. Helpers and normalized values are immutable; normalization copies input
objects. Negative lengths are valid for coordinates. Sizing and inset operations
require nonnegative resolved values.

```ts
import { em, px, resolve_length, measure_length } from '@gum-jsx/core/next';

const basis = { font_size: 16, fraction: 200 };
resolve_length(0.5, basis);       // 100 pixels
resolve_length(em(2), basis);     // 32 pixels
resolve_length(px(10));          // 10 pixels

measure_length(0.5);             // { value: 0.5, unit: 'fraction' }
resolve_length(0.5, { fraction: 0 }); // 0 pixels: a known zero reference
resolve_length(0);               // 0 pixels: no reference needed
```

`measure_length` preserves an unresolved dependency for an intrinsic query.
`resolve_length` is the final-layout operation: an unresolved nonzero length throws
`UnresolvedLengthError`, with its length and source property path. It never guesses
a percentage reference from an offer. A caller can resolve a retained value again
once its reference becomes definite. General percentage cycles are deferred.

`resolve_sizing` and `resolve_insets` accept a separate `LengthContext` containing
`font_size`, `reference: { width?, height? }`, and a diagnostic `path`. Width and
horizontal insets use reference width; height and vertical insets use reference
height. The reference is the parent's established content box before flex slots
are allocated. Deflating an offer does not change that reference.

Resolve `font_size` first using `resolve_font_size(value, inherited)`. Both its
relative forms refer to the inherited size. Subsequent em lengths and line height
use the resolved local font size. Defaults live in [defaults.ts](./defaults.ts):
16px text, 1.2em line height, 16px natural shape height, and 1px stroke width. The
line-height helper also accepts a raw fraction of the local font size.

Fractional gaps will use the stack's definite main-axis length. Shape coordinates
will use their own resolved rectangle; scalar radii and strokes will use its
shorter side. Those callers arrive with stacks and shapes. A zero reference is
definite even for degenerate geometry. Dimensionless aspect and flex weights are
ordinary numbers, independent of the length syntax.

## Requests and size selection

All request values and geometry records are **resolved pixels**. The raw-number
fraction rule applies to source length properties, not these internal records.
There is no `unit_size` or implicit layout scaling.

| Axis request | Meaning |
|---|---|
| `natural()` | Ask for a natural dimension, with no space budget. |
| `available(n)` | Offer an advisory pixel budget; the measured result can exceed it. |
| `exact(n)` | Allocate exactly this many pixels, recording excess content as overflow. |

`make_request()` defaults both axes to natural. Numeric requests must be finite
and nonnegative; zero is an exact value, not an absent dimension.

```ts
import {
  available, make_request, resolve_sizing, prepare_request, finish_size, make_size,
} from '@gum-jsx/core/next';

const context = { reference: { width: 640 }, path: 'root/child' };
const sizing = resolve_sizing({ width: 0.5 }, context);
const request = make_request({ width: available(400) });
const prepared = prepare_request(request, sizing); // width: exact(320)

// A real element would measure its content using `prepared` here.
const content = make_size(300, 20);
const size = finish_size(content, prepared, sizing); // 320×20
```

Use the same resolved sizing for preparation and completion. Preparation and
completion are pure, and preparation is idempotent. They do not measure, reflow,
or scale content themselves.

The precedence is:

1. An incoming exact allocation wins over preferred dimensions and min/max limits.
2. Otherwise an explicit dimension, clamped to its own min/max, becomes exact.
3. Otherwise available space is clamped to min/max before measuring. A natural
   request with a finite maximum becomes an available offer at that maximum.
4. Completion clamps measured dimensions to min/max; it does not clamp them to
   advisory offers. An exact axis always reports its allocation.

`resolve_sizing` requires definite bases even for a preferred dimension that a
later exact allocation overrides. Missing references and invalid min/max ranges
are errors in the source sizing policy. An omitted maximum is represented by
`Infinity` in the resolved policy only; allocated geometry is always finite.

`shape_size` establishes the preferred-aspect policy for shapes: two exact axes
win; one exact axis derives the other; otherwise the shape fits the available
axes while preserving aspect. With two natural axes it uses the default height.
Own min/max limits can also override aspect. Other content uses its measured
natural size; `finish_size` does not impose a shape's ratio on text or containers.

## Insets and fragments

`resolve_insets` accepts a uniform length or named `{ left, top, right, bottom }`
fields. Missing sides default to zero. Deflation floors inner dimensions at zero;
inflation preserves the full inset extent, including when it cannot fit.

Box dimensions will denote the border box, including padding and border but
excluding margin. Padding and border deflate the child's space; margin is
accounted for by the parent. This stage supplies the arithmetic, not Box itself.

The [fragment schema](./fragment.ts) contains only the result for one request:

- `size`: the allocated rectangle, based at the local origin.
- `guides`: optional named pixel positions, initially `baseline` from the top.
- `ink`: painted bounds after clipping, or `null` for no paint.
- `overflow`: nonnegative excess content on each side, recorded before clipping.
- `draw`: drawing records, whose concrete types arrive with the SVG renderer.
- `children`: child fragments with local offsets and optional affine transforms.

The parent owns placement. An explicit transform acts in child coordinates before
the placement offset; ordinary placement changes neither font size nor stroke
width. The same fragment can be placed more than once. A fragment carries no
mutable source element or layout-pass state.

The schema is readonly. Geometry, unit, request, and sizing constructors also
freeze their owned records. The gallery constructs frozen fragment trees;
stage 2's fragment construction will own and freeze drawing and placement data.
`bounds_overflow` compares an unclipped content rectangle with the allocation;
painting and clipping do not retroactively change that layout result.
