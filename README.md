# Next core

Stages 1 and 2 are implemented: units and sizing, immutable element descriptions,
layout passes, immutable fragments, JSX evaluation, and SVG rendering. Import the
experimental API from `@gum-jsx/core/next`. Real text and the remaining shapes come
next; the current elements are `Svg` and `Rect`.

Run directly from this directory, including inside its checkpoint repo:

```sh
bun scripts/gum.ts examples/repeated.jsx -f tree --stats
bun scripts/gum.ts examples/repeated.jsx -o /tmp/repeated.svg
bun scripts/gum.ts examples/repeated.jsx -o /tmp/repeated.png --ratio 2
bun scripts/gallery.ts
bun test/run.ts
```

PNG output uses the optional local `rsvg-convert` command. SVG, tree, and JSON
output need only Bun and the existing core dependencies. The PNG ratio changes
sampling resolution while preserving the layout viewport. The CLI accepts a JSX
file or stdin; `--help` lists its options. The [gallery](./examples/README.md)
contains source, SVG, PNG, and exact numerical trees.

From `gum-jsx-core`:

```sh
bun run test:next
bun run probe:next
bun run probe:next hugging_box
bun run gum:next src/next/examples/repeated.jsx -f tree
bun run gallery:next
bun run typecheck
```

The stage 1 [contract probes](./examples/contracts.ts) remain executable:

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

Fractional gaps will use the stack's definite main-axis length. A rectangle's
fractional stroke width uses its own shorter side. Other shape coordinates will
use their own resolved rectangle; scalar radii will use its shorter side.
A zero reference is
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
- `draw`: resolved rectangle drawing records; more drawing kinds follow with shapes and text.
- `children`: child fragments with local offsets and optional affine transforms.
- `clip`: an optional local rectangle clipping the fragment and its descendants.
- `name`: an optional inspection label, assigned from the element type by the pass.

The parent owns placement. An explicit transform acts in child coordinates before
the placement offset; ordinary placement changes neither font size nor stroke
width. The same fragment can be placed more than once. A fragment carries no
mutable source element or layout-pass state.

`make_fragment` owns and freezes drawing and placement data. It aggregates local
ink and child ink, transforms child bounds, and retains both layout and paint
overflow before clipping. Its `ink` is the visible result after its own clip.
`place_fragment` preserves an owned fragment's identity; external records are
normalized first. `PixelRect` names the public geometry type, leaving `Rect` for
the element constructor.

## Elements and layout passes

JSX creates descriptions without doing layout:

```jsx
<Svg width={px(240)} height={px(120)} font_size={px(20)}>
  <Rect width={0.75} height={em(3)} fill="#49a895" stroke="none" />
</Svg>
```

`evaluate(code, { scope?, name? })` evaluates a bare JSX element or JavaScript that
returns one. Function components, spreads, and JSX fragments work through the
existing Acorn parser; no old element or layout engine is used. Extra scope values
belong to this evaluation. This runs ordinary trusted JavaScript, with its normal
access to the host runtime.

`Svg` requires explicit `px()` width and height and accepts one content element.
It establishes that child's reference box and offers the viewport as available
space. An exact request can resize the viewport. For a bare element, the CLI needs
both `--width` and `--height` and creates the viewport around it. `Rect` follows
the stage 1 aspect policy. Its SVG path traces its layout rectangle, so a stroke
extends half its width beyond the path; the fragment records that ink and overflow.
An empty or zero-area rectangle paints nothing.

The same source can answer different allocations without being rebuilt:

```ts
import { Rect, Svg, px, em, LayoutPass, make_request, exact, render_svg }
  from '@gum-jsx/core/next';

const tile = new Rect({ width: 0.5, height: em(2), stroke_width: px(2) });
const scene = new Svg({ width: px(160), height: px(80), children: tile });
const pass = new LayoutPass();
const first = pass.layout(scene); // child: 80×32, 2px stroke
const second = pass.layout(scene, make_request({
  width: exact(320), height: exact(120),
}));                            // child: 160×32, 2px stroke
const svg = render_svg(second);
```

Constructors snapshot and deeply freeze source records and arrays, preserving
child element identities. They store no geometry, caches, or inherited style.
Opaque resources belong to the pass. The pass resolves the local font size and
inherited paint before preparing requests or running the element's layout method.
Paint defaults are an unfilled shape with a black 1px stroke.

`define_element(name, layout)` returns a constructor for a custom element. Its
layout function receives readonly source props and a frozen query:

| Query field | Meaning |
|---|---|
| `request` | Prepared pixel requests, including explicit preferred dimensions. |
| `sizing` | Resolved preferred sizes, min/max, and aspect. |
| `style` | Resolved font size and inherited paint; stroke units await shape geometry. |
| `reference` | The established **parent** content box used for this element's lengths. |
| `path` | The instance path for diagnostics; it must not affect geometry. |
| `child(element, request, reference?, index?)` | Query a child with inherited style and its own path. |
| `resource(name)` | Read a pass-owned resource during measurement. |

Pass a child's percentage reference explicitly once the container establishes its
own content box. Omission leaves the reference indefinite. A finite available offer
alone does not establish that box.

A layout method finishes its measured size with `finish_size` or `shape_size`, then
returns `make_fragment(...)`. The pass validates its result against the request and
size policy; an incorrect exact size is an error. Fixed content can draw its natural
geometry inside a smaller allocated frame and record overflow. See the synthetic
[fixed, expanding, and wrapping leaves](./examples/leaves.ts) and the custom parent
in [repeated.jsx](./examples/repeated.jsx). These are protocol fixtures, not the
future text or standard container implementations.

Natural queries and constrained queries use this same method. Cache entries are
keyed by element identity, request, resolved style, percentage reference, and a
resource epoch. Widths are not rounded. `pass.stats` exposes query, layout, and hit
counts. Diagnostic paths and placement offsets are excluded from geometry keys;
errors retain their own paths and are never cached.

Register a resource with `pass.set_resource(name, value, version)`, or supply a
record of `{ value, version }` entries to the constructor. Advance the version when
its contents change. Updates conservatively invalidate the pass cache, including
parent results. Existing fragments remain independent of subsequent resource
changes. Finer resource dependency tracking can follow measured need.

## Rendering and inspection

`render_svg(fragment, { title?, background?, id_prefix? })` consumes only fragments.
It emits escaped SVG, resolved drawing geometry, explicit placement transforms,
and rectangular clip definitions. It performs no layout or font work. Definition
IDs are allocated per render and reused for repeated placements of a shared clip;
speculative layout queries cannot consume IDs. Supply distinct `id_prefix` values
when embedding several generated documents inline in one page.

`inspect_fragment(fragment)` prints local sizes, offsets, matrices, ink, overflow,
and guides. The CLI's `tree` format uses it; `json` exposes the complete result.
The renderer uses the fragment's allocated size directly as both SVG dimensions
and viewBox extent. Ordinary resizing relays a new request through the layout pass;
only an explicit placement matrix scales completed geometry and strokes.
