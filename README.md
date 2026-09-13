# Next core

Stages 1–5 are implemented: units and sizing, immutable descriptions and fragments,
layout passes, JSX, SVG rendering, measured text, shapes, Box composition, and stacks.
Stage 6(a) adds positioned Group canvases. The next slice implements basic
plotting and its composition, geometry, and text dependencies; wrapping rows
and grids remain deferred. See the [plotting overview](../docs/PLOTTING.md).

This README describes the implemented API; [contributor notes](#contributor-notes)
cover how to work on it.
[ROADMAP.md](../docs/ROADMAP.md) tracks completed stages and future work;
[DESIGN.md](../docs/DESIGN.md) records the accepted decisions and the original assessment
of the legacy implementation. The old assessment's APIs and bug reports are historical.

Install workspace dependencies with `bun install` from the parent directory,
then check the core from this directory:

```sh
bun run test
bun run typecheck
```

Runtime dependencies are `acorn`, `acorn-jsx`, `fontkit`, and `linebreak`.
`opentype.js` is a test dependency; TypeScript and library declarations are
development dependencies. Runtime code lives in `src/`, with `src/index.ts` as
the package entry point. The JSX parser and its source-error helpers live in
`src/lib/`, declarations in `src/types/`, and the six bundled IBM Plex faces in
`src/fonts/` with their OFL license. Tests, tools, and examples live in the
top-level `test/`, `scripts/`, and `examples/` directories. No files or packages
from the old core checkout are needed.

The rendering command now lives in [gum-next-cli](../gum-next-cli/README.md).
From the workspace root, render an example with:

```sh
bun run gum gum-next-core/examples/hugging.jsx -f tree --stats
bun run gum gum-next-core/examples/card.jsx --width 220 -o /tmp/card.png
```

The CLI accepts a JSX file or stdin and defaults to kitty graphics on stdout.
Use `--format` or an output filename to select SVG, PNG, tree, or JSON output.
PNG uses [gum-next-png](../gum-next-png/README.md). See the CLI README for options and
viewport behavior. The core's [gallery](./examples/README.md) contains source,
SVG, PNG, and exact numerical trees.

Core development tools remain available from this directory:

```sh
bun run probe
bun run probe hugging_box
bun run gallery
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
import { em, px, resolve_length, measure_length } from 'gum-next-core';

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
use the resolved local font size. Defaults live in [defaults.ts](./src/defaults.ts):
16px text, 1.2em line height, a 16px natural shape fallback, and 1px stroke width. The
line-height helper also accepts a raw fraction of the local font size.

Fractional gaps use the stack's definite main-axis length. Shape coordinates
use their own resolved rectangle; scalar radii and stroke widths use its shorter
side. Two-axis radii resolve per axis. A zero reference is
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
} from 'gum-next-core';

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

`shape_size` fills offered axes independently when no aspect is specified. An
unoffered axis uses the 16px natural fallback, independently of the other axis.
Preferred dimensions and min/max limits apply through the shared sizing policy.

An explicit `aspect`, or the intrinsic 1:1 aspect supplied by Square and Circle,
couples the axes: two exact axes win; one exact axis derives the other; otherwise
the shape fits the available axes while preserving aspect. With two natural axes
it uses the default height. Own min/max limits can also override aspect. Other
content uses its measured natural size; `finish_size` does not impose a shape's
ratio on text or containers.

## Insets and fragments

`resolve_insets` accepts a uniform length or named `{ left, top, right, bottom }`
fields. Missing sides default to zero. Deflation floors inner dimensions at zero;
inflation preserves the full inset extent, including when it cannot fit.

Box dimensions denote the border box, including padding and border. Padding and
border deflate the child's space. External spacing is another Box's padding;
each layer owns its size, style, and child reference box.

The [fragment schema](./src/fragment.ts) contains only the result for one request:

- `size`: the allocated rectangle, based at the local origin.
- `content`: optional usable content rectangle; Box exposes the space inside its insets.
- `guides`: optional named vertical pixel positions, including `baseline` from the top.
- `ink`: painted bounds after clipping, or `null` for no paint.
- `overflow`: nonnegative excess content on each side, recorded before clipping.
- `draw`: resolved rectangle, ellipse, and path drawing records, including glyph outlines.
- `children`: child fragments with local offsets and optional affine transforms.
- `clip`: an optional local rectangle with optional rounded corners, clipping the fragment and its descendants.
- `name`: an optional inspection label, assigned from the element type by the pass.
- `label`: optional accessible content; Text retains its normalized logical string here.

The parent owns placement. An explicit transform acts in child coordinates before
the placement offset; ordinary placement changes neither font size nor stroke
width. The same fragment can be placed more than once. A fragment carries no
mutable source element or layout-pass state.

`make_fragment` owns and freezes drawing and placement data. It aggregates local
ink and child ink, transforms child bounds, and retains both layout and paint
overflow before clipping. Its `ink` is the visible result after its own clip.
Rounded clips render their actual curves; their reported ink uses a conservative
intersection with the clip's bounding rectangle. Singular transforms paint nothing.
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

Named constants are available both in evaluated JSX and as imports from
`gum-next-core`: `sans`, `mono`, `light` (300), `regular` (400), `bold` (700),
`none`, `white`, `black`, `blue`, `red`, `green`, `yellow`, `purple`, `gray`,
`lightgray`, `darkgray`, `slate`, and `e`, `pi`, `tau`, `phi`, `r2d`, `d2r`.
For example, `<Text font_family={sans} font_weight={bold} color={blue}>Hello</Text>`.
Colors use the original Gum palette; see the
[style reference](../gum-next-docs/topics/text/Style.md) for their exact values.

JSX attribute names also accept dashes: `font-size` becomes `font_size`, and
`stroke-dasharray` becomes `stroke_dasharray`. This applies to built-in elements
and function components; values are unchanged and the last attribute wins when
both spellings are used. JavaScript object keys, including spread props, keep
their spelling, so use underscores there.

`evaluate(code, { scope?, name?, seed? })` evaluates a bare JSX element or JavaScript that
returns one. Function components, spreads, and JSX fragments work through the
existing Acorn parser; no old element or layout engine is used. Extra scope values
belong to this evaluation. This runs ordinary trusted JavaScript, with its normal
access to the host runtime.

`Svg` accepts one content element and optional `px()` width and height. Each
omitted axis hugs the child's measured allocation, including any surrounding Boxes.
A fixed width with an omitted height supports reflowing documents; omitting both supports
fully natural composition. An exact request can resize either axis. Established
axes become child percentage references and available-space offers. A hugging
axis remains indefinite during measurement; its final size is never fed back as
a percentage basis. An empty unsized Svg is 0×0.

The viewport follows layout bounds, not ink, and clips overflow at its edges.
An unsized `Rect` fills both available viewport axes. Its stroke straddles its
geometry, so half the stroke extends outside the layout rectangle; the fragment records that
ink and overflow. An empty or zero-area rectangle paints nothing. Box borders
instead consume layout space and stay entirely inside their border box.

The same source can answer different allocations without being rebuilt:

```ts
import { Rect, Svg, px, em, LayoutPass, make_request, exact, render_svg }
  from 'gum-next-core';

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

Extend `Element<Props>` and define `static layout(props, query)` for a new primitive.
The inherited constructor accepts props, derives the class name, merges optional
`static defaults`, and owns the resulting immutable description. No constructor
or descriptor wiring is needed. Related elements can inherit behavior and override
just their defaults:

```ts
class SmallRect extends Rect {
  static defaults: Partial<RectProps> = {
    width: px(32), height: px(16), fill: 'tomato',
  };
}
const tile = new SmallRect({ width: px(48) });
```

Defaults merge across the class hierarchy and are snapshotted on first use.
Instance props override them, including explicit `undefined`. Static hook references
are captured at the same time; configure classes before constructing instances.
Use `static element_name` for an explicit diagnostic name, or preserve class names
when minifying. Defaults become ordinary source data visible to parents; Spacer
uses this for its flex defaults. The base constructor freezes the instance, so
source data belongs in props, with no ordinary instance field initializers.

`Element` is available inside JSX as well as through imports. `define_element(name,
layout, defaults?, options?)` remains a convenience using the same machinery; its
defaults are captured at the factory call. Both forms support normalization and
data bounds; see [Custom elements](../gum-next-docs/topics/text/CustomElements.md).
The layout function receives readonly props and a frozen query:

| Query field | Meaning |
|---|---|
| `request` | Prepared pixel requests, including explicit preferred dimensions. |
| `sizing` | Resolved preferred sizes, min/max, and aspect. |
| `style` | Inherited font and paint; font size is resolved, relative line height and stroke width retain their units. |
| `reference` | The established **parent** content box used for this element's lengths. |
| `path` | The instance path for diagnostics; it must not affect geometry. |
| `child(element, request, reference?, index?)` | Query a child with inherited style and its own path. |
| `resource(name)` | Read a pass-owned resource during measurement. |
| `prepare(name, compute)` | Cache source/style/resource work independently of requests and percentage references. |

Pass a child's percentage reference explicitly once the container establishes its
own content box. Omission leaves the reference indefinite. A finite available offer
alone does not establish that box.

`child(...)` and `pass.layout(...)` return the element's own layout result. The
pass resolves shared style and sizing, runs the layout method, validates its size,
and caches the fragment. Insets, placement, and decoration belong to elements.
Element-specific properties are interpreted by the element's layout method.
The direct stack parent interprets a child's `basis`, `grow`, and `shrink`; these
properties introduce no policy in the layout pass and do not inherit.
Similarly, Group reads its direct children's `x`, `y`, and `anchor`. These properties
do not move elements inside Box or a stack, or acquire behavior in LayoutPass.

A layout method finishes its measured size with `finish_size` or `shape_size`, then
returns `make_fragment(...)`. The pass validates its result against the request and
size policy; an incorrect exact size is an error. Fixed content can draw its natural
geometry inside a smaller allocated frame and record overflow. See the synthetic
[fixed, expanding, and wrapping leaves](./examples/leaves.ts) and the custom parent
in [repeated.jsx](./examples/repeated.jsx). These fixtures exercise custom layout
policies independently of Text and the standard containers.

Natural queries and constrained queries use this same method. Cache entries are
keyed by element identity, request, resolved style, percentage reference, and a
resource epoch. Widths are not rounded. `pass.stats` exposes query, layout, and hit
counts. Diagnostic paths and placement offsets are excluded from geometry keys;
errors retain their own paths and are never cached.

Register a resource with `pass.set_resource(name, value, version)`, or supply a
record of `{ value, version }` entries to the constructor. Advance the version when
its contents change. Updates conservatively invalidate the pass cache, including
parent results. Existing fragments remain independent of subsequent resource
changes. Prepared content is invalidated along with layout results. A preparation
must not depend on the current request, percentage reference, or diagnostic path.
Finer resource dependency tracking can follow measured need.

## Box composition

This is a complete 100×100 document, with no manual placement or root dimensions:

```jsx
<Svg>
  <Box padding={em(1)} border_width={px(2)}>
    <Square width={px(64)} fill="#63b49d" stroke="none" />
  </Box>
</Svg>
```

Square reports 64×64. Box adds 16px padding and a 2px border on each side; Svg
adopts its 100×100 result. Each element receives one layout query. See the
[source, image, and tree](./examples/README.md) for this and the framed paragraph.

Box has at most one content element; put text in an ordinary `Text` child. It
hugs measured content unless its own sizing or an exact request fixes an axis.
An available width is passed inward for reflow, without scaling glyphs or strokes.
The shared `layout_content` operation deflates the request, queries the child,
inflates its answer, selects the final size, and aligns the completed fragment.
Svg uses the same operation with no insets. Neither reconstructs source elements.

| Prop | Meaning |
|---|---|
| `width`, `height`, `min_width`, etc. | The shared sizing policy, applied to the border box. |
| `padding` | Uniform length or named sides; default zero. |
| `border_width` | Uniform length occupying space inside all four edges; default zero. |
| `border_color` | Border paint; defaults to the resolved text `color`. |
| `background` | Local fill behind the content; default `"none"`. |
| `radius` | Rounded outer corners; scalar, `{x,y}`, or `[x,y]`, default zero. Clamped to the box. |
| `align` | `"start"`, `"center"`, `"end"`, `"stretch"`, or a number from 0 to 1; also accepts `{x,y}` or `[x,y]`. Default start on both axes. |
| `clip` | Clip the child inside the border, including the padding area; default false. |

Background and border are local decoration. Ordinary `fill`, `stroke`, and font
props still inherit to children. `Frame` is Box with a default 1px border.
The border paints above the child, wholly inside the frame, even when thicker
than half the box. Its drawing construction introduces no extra ink overflow.

Box resolves em padding and border against its own font size, before querying
the child. Fractional padding uses the corresponding parent content axis.
Fractional border width uses the parent's shorter side, requiring both
axes; it cannot depend on the unresolved size that it helps determine. Radius
is decoration and resolves against Box's final rectangle. Prefer `px()` or `em()`
for border width in a naturally sized tree.

Only an exact axis or equal min/max limits establish a content reference before
measurement. For example, `<Svg width={px(360)}><Box width={1}>…</Box></Svg>`
gives Box a definite width, then gives its child that width minus padding and
border. Box and Svg can both hug height. A nonzero fractional child height on
that unresolved axis produces a property-path error, without iteration.

Alignment positions the child's allocated box. Numeric alignment is dimensionless:
0 is start, 0.5 center, and 1 end. Stretch sends an
exact child request on axes established before measurement; other axes still
hug. Center/end alignment may give oversized children negative offsets. Baselines
move with the child. Clipping changes visible ink and retains overflow.

Use nested Boxes for spacing outside a decorated frame:

```jsx
<Box padding={px(8)}>
  <Box width={px(80)} padding={px(4)} border_width={px(1)}>
    <Text>Hello</Text>
  </Box>
</Box>
```

The inner border box is 80px wide; the outer padding brings the total to 96px.
Set `align="stretch"` on the outer Box to pass exact allocations inward: a 60px
allocation then leaves 44px for the inner Box. Ordinary alignment offers that
space and lets the child retain its preferred width, recording overflow.

Each wrapper is a real container. Its children use its established content box
for percentages, and its em padding uses its own font size. External spacing has
no separate `margin` prop or implicit wrapper in the layout pass. Empty boxes
measure their padding plus border; an empty undecorated Box is 0×0. Oversized
insets floor content dimensions at zero and retain their full excess as overflow.

`Fit` is an explicit uniform transform of one naturally measured child:

```jsx
<Fit width={px(280)} height={px(80)} mode="contain">
  <Text font_size={px(16)}>One fitted line</Text>
</Fit>
```

Fit occupies finite offered axes; unoffered axes follow the scaled child. It
establishes its chosen target axes as references, then queries the child naturally.
`contain` fits within the target, `cover` fills it with possible overflow, and
`scale_down` contains without enlarging. Alignment defaults to center and accepts
the same positions as Box, excluding stretch. `clip` defaults to false; enable it
for cropped cover fitting. Fit scales the child's allocated rectangle, including
any nested padding, glyphs, strokes, and guides; it does not fit ink extents. Text
keeps its natural line breaks instead of reflowing to the target width. Zero source axes
contribute no scale ratio, and a zero target can produce an invisible scale of zero.

## Stacks

HStack packs left to right; VStack packs top to bottom. Both use the same
main-axis/cross-axis implementation. They accept any number of element children,
including arrays, JSX fragments, and conditional children. Empty stacks are 0×0
unless their own sizing or an exact request requires more space.

```jsx
<Svg width={px(400)}>
  <HStack width={1} gap={px(12)} align="center">
    <Text width={px(80)}>Label</Text>
    <Text grow={1} shrink={1}
      text="A paragraph gets the remaining width and reflows to find its height." />
    <Square width={px(40)} fill="#317969" stroke="none" />
  </HStack>
</Svg>
```

The paragraph receives 256px: 400 minus the 80px label, 40px Square, and two
12px gaps. Its font keeps its size. The row takes the tallest resulting allocation,
and Svg hugs the row's height. See [stack.jsx](./examples/stack.jsx) for two such
rows nested inside columns and a Box, at two viewport widths. For plain JSX text,
outer blank lines and common indentation are removed automatically. Internal
text newlines still become line breaks; keep each paragraph on one content line
or use `text={...}` when source formatting should not introduce breaks.

Without dimensions or flex weights, stacks hug natural content. This 52×32 row
needs one query per element, including Svg:

```jsx
<Svg>
  <HStack gap={px(4)}>
    <Square width={px(32)} stroke="none" />
    <Square width={px(16)} stroke="none" />
  </HStack>
</Svg>
```

| Stack prop | Meaning |
|---|---|
| `width`, `height`, `min_width`, etc. | Shared sizing for the stack's full allocation. |
| `gap` | Length between adjacent children, default zero. No leading or trailing gap. |
| `align` | Cross-axis `"start"` (default), `"center"`, `"end"`, `"stretch"`, or a number from 0 to 1. HStack also accepts `"baseline"`. |
| `justify` | Main-axis `"start"` (default), `"center"`, `"end"`, a number from 0 to 1, `"space_between"`, `"space_around"`, or `"space_evenly"`. |

Flex properties belong to the **direct child** of a stack. Put them on an enclosing
Box when the Box is the item being allocated; they do not pass through wrappers.

| Child prop | Meaning |
|---|---|
| `basis` | Starting main-axis length. Otherwise use the child's preferred width/height, otherwise its measured natural size. |
| `grow` | Nonnegative weight for surplus space, default **0**. |
| `shrink` | Nonnegative shortage weight, default **0**; multiplied by the original basis. |
| `min_width`, `max_width`, etc. | Bounds on the stack's main-axis allocation to this item. |

The allocator reserves gaps, clamps bases, then distributes surplus or shortage
among participating children. Growth uses `grow`; shrinkage uses `shrink × basis`.
Items reaching limits freeze and the remaining space is redistributed. Zero weights
keep their clamped bases. If maxima prevent filling the frame, `justify` places the
unused space. If minima or zero shrink weights prevent fitting, overflow remains
explicit; the stack does not clip. Wrap it in a Box with `clip` when needed.

`basis={0} grow={1}` gives an item an equal share of remaining space alongside
other such items. `grow={1}` alone adds equal surplus to potentially unequal
natural bases. `width={0.5}` instead means half the stack's **full established
width**, before subtracting gaps. Two half-width children plus a gap overflow
unless shrinking is enabled. A fraction used as `basis` follows the same rule.

Basis, preferred sizes, and limits resolve using the child's local font size;
the gap uses the stack's font size. A fractional gap uses the stack's established
main-axis length. Those references stay fixed across every probe and allocation.
For example, `HStack width={1}` under a fixed-width Svg establishes that width.
An unsized HStack may still hug under a finite available offer; that offer alone
does not establish a reference for nonzero fractional child widths or gaps.

Stacks use a finite main-axis offer as a flex budget but hug what is actually
used unless their own sizing or an exact request fixes the frame. Cross-axis
offers pass inward for measurement. A natural main axis packs clamped bases;
an own minimum can supply additional space to growing items.

Text is measured at the selected width before the stack determines its height.
For `align="stretch"`, a definite cross axis becomes an exact child request. On a
hugging cross axis, a column selects its shared width and remeasures text heights
before allocating vertical space; a row allocates widths and reflows text before
selecting the shared height. Stretch may override a child's preferred cross size
and cross limits, following the exact-request contract. The selected cross size
is never fed back into percentage references. These are bounded measurement
phases, with no aspect-fitting search or font scaling.

Baseline alignment uses each child's first `baseline` guide, falling back to its
bottom edge. The row includes the largest extent above and below that guide.
Stacks propagate the first guided child's guides and the last textual child's
`last_baseline`, shifted into the stack's coordinates. `justify` only positions
completed main-axis slots; `align` positions their cross axes; `Text.text_align`
positions text inside its own allocation. Center/end can use negative offsets
for overflowing content. Distributed spacing only adds positive free space to gaps.

`Spacer` is an empty element whose source defaults are `{ basis: 0, grow: 1 }`.
It needs no parent type check, has no ink, and is zero-sized naturally. Override
its basis, weights, or bounds like any other stack child. For a fixed spacer, use
`<Spacer basis={px(20)} grow={0}/>`; its default zero basis takes precedence over
a preferred main-axis dimension.

The pure [flex allocator](./src/flex.ts) accepts resolved pixel bases and bounds and
returns immutable sizes. The [stack implementation](./src/stack.ts) owns child queries,
text reflow, guides, and placement. LayoutPass remains independent of both policies.

## Positioned groups

`Group` is a canvas for independently positioned children. It establishes its
rectangle before measuring them, fills finite offers, and accepts the shared
width/height and min/max sizing props. A preferred `aspect` can derive an omitted
axis or fit within two available axes; exact axes take precedence, as for shapes.

```jsx
<Svg width={px(400)}>
  <Group aspect={2}>
    <Rect fill="#edf4f1" stroke="none" />
    <Circle x={0.25} y={0.5} anchor="center" width={px(60)}
      fill="#317969" stroke="none" />
    <Text x={0.5} y={0.5} anchor={{ y: 'center' }} width={0.4}
      text="A label in its own region." />
  </Group>
</Svg>
```

This SVG is 400×200. The Circle's center is `(100,100)`, its diameter is 60px,
and the Text has a 160px region beginning at x=200. Its line count determines
its own height; `anchor` centers that allocation vertically on y=100. The first
Rect fills the canvas and paints behind the other children.

| Prop | Meaning |
|---|---|
| Group `width`, `height`, `min_width`, etc. | Shared sizing for the canvas; independent of child bounds. |
| Group `aspect` | Optional preferred width/height ratio, using the same sizing rules as shapes. |
| Group `clip` | Clip painted ink to the canvas rectangle, default false; overflow is retained. |
| Child `x`, `y` | Position lengths, default zero. Fractions reference the corresponding full canvas axis; negatives and values outside the canvas are allowed. |
| Child `anchor` | The point of the child's allocated box that meets `(x,y)`. Default `"start"` (top-left); also `"center"`, `"end"`, a number from 0 to 1, or `{x,y}` / `[x,y]` with these values. |
| Child `width`, `height`, etc. | Ordinary sizing, resolved against the canvas. Use these to define a text region or shape size. |

The canvas must have both axes supplied by dimensions or finite offers, or one
axis plus an aspect. For example, `<Svg width={px(200)} height={px(100)}><Group>…`
needs no Group dimensions. A bare `<Group width={px(200)} height={px(100)}>`
can be hugged by its enclosing Svg. A Group with unresolved axes reports an error
before querying children, including when empty. Explicit zero is valid. Group
does not infer a viewport from positioned children or fall back to a shape's 16px
natural size. Use Box and stacks for composition whose size comes from content.

Group commits to its chosen size, so even axes selected from available offers
become definite percentage references for its children. All children receive an
available offer of the **whole canvas**. Their own sizing then selects any smaller
region. Moving a child or changing its anchor does not reduce the offer to the space
between its position and the canvas edge. An unsized Rect therefore fills the whole
canvas, even at a nonzero position; give it width and height for a smaller region.

Position em lengths use the child's resolved local font size, matching its other
lengths. Anchors are dimensionless fractions of the allocated child rectangle, not
its painted ink. `anchor="center"` subtracts half the child's width and height;
`anchor={[1, 0]}` or `anchor={{x: "end", y: "start"}}` places its top-right corner
at the position. Tuple entries can mix fractions and keywords, for example
`anchor={['end', 0.5]}`. Per-axis Box/Fit/Anchor alignment and Rotate origins also
accept tuples. Stack alignment stays a single-axis value.
There is no stretch anchor; width and height control sizing.

Position metadata belongs to the direct child. Put it on the Box or VStack when
that container is what Group should place. Nested Groups create local canvas
references: a half-width child of a half-width Group occupies a quarter of the
outer width. Source order is paint order. Group has no implicit baseline from its
arbitrarily placed labels; child fragments retain their local guides.

Group uses one query per child, then positions completed fragments. Pixel-sized
fonts and strokes remain pixel-sized when the canvas changes; text reflows within
its region. Use a positioned `Fit` when the intent is to scale a completed drawing.
Clipping affects visible ink and leaves allocations and unclipped overflow inspectable.

See the [Group implementation](./src/group.ts) and the
[canvas, anchors, and clipping examples](./examples/README.md). Stage 6(a) covers
this positioned canvas. Wrapping stacks, content-sized overlays, grid tracks, and
the optional common-height figure policy remain later work.

## Text and fonts

```jsx
<Svg width={px(360)} height={px(200)} font_size={px(18)} color="#203746">
  <Text width={px(320)} line_height={em(1.4)}>
    A paragraph with <Span font_weight={bold}>bold words</Span> and <Span font_style="italic">italic words.</Span>
  </Text>
</Svg>
```

`Text` accepts strings, numbers, nested arrays, conditional children, and inline
`Span` elements. `text="..."` is a convenience alternative to children. Spans inherit
font family, weight, style, size, line height, and `color`; they introduce no boxes
or word breaks. A standalone `Span` can also be measured as text. Other graphics
belong beside Text through composition. Inline spans have style props, not sizing
or independent layout props.

Text defaults to IBM Plex Sans, weight 400, 16px, 1.2em line height, and black.
`color` paints glyphs; `fill`/`stroke` paint shapes. Relative font sizes refer to the
inherited size; relative line height refers to each run's newly resolved size.
An inherited `line_height={px(20)}` remains 20px even in a larger span.

| Text property | Behavior |
|---|---|
| `wrap` | Defaults to true; wrap at supported Unicode line-break opportunities. |
| `whitespace="normal"` | Collapse horizontal spaces/tabs and trim hard-line edges; **retain explicit newlines**. |
| `whitespace="pre"` | Preserve spaces and expand tabs at `tab_size` column stops (default 4). Wrapping remains independently controlled by `wrap`. |
| `text_align` | `left` (default), `center`, or `right`, inside the final allocated width. |
| `font_family` | `IBM Plex Sans`, `IBM Plex Mono`, or a registered family. |
| `font_weight` | Numeric 1–1000; choose the nearest available weight, lower on ties. Bundled weights are 300, 400, 700. |
| `font_style` | `normal` or `italic`; a registered italic face is preferred, otherwise synthesize a 12° oblique outline. |

Newlines include CRLF/CR and Unicode line/paragraph separators. A trailing newline
adds a blank line; empty normal text is 0×0. Nonbreaking spaces remain nonbreaking;
zero-width spaces permit a break without painting a glyph. JSX formatting-only
multiline children are removed by the parser. Other literal JSX text loses outer
blank lines and common indentation across the element's children, while internal
breaks and same-line spaces around spans survive. Thus `<Text>Revenue</Text>`
and the following have the same content and size:

```jsx
<Text>
  Revenue
</Text>
```

JavaScript strings in expressions and attribute values bypass JSX cleanup.
For exact spaces or blank lines, use an explicit string with `whitespace="pre"`,
such as `<Text whitespace="pre">{'  Revenue  \n'}</Text>`. The whitespace prop
controls layout after parsing; it does not disable source normalization. Element
containers and text stacks ignore blank strings between children. See the
[JSX reference](../gum-next-docs/topics/text/JSX.md#jsx-whitespace) for more examples.

Automatic hyphenation, emergency word splitting, full paragraph
bidi, fallback font chains, and color emoji are outside this stage's coverage.
Unknown families and missing glyphs produce errors instead of silent substitution.

Text hugs its measured width under a natural or available request. An exact width
fixes the frame and reflows its lines; an unbreakable word can overflow it, including
a zero-width frame. Height requests never scale glyphs or truncate lines. Min/max
limits and preferred dimensions use the same sizing policy as other elements.

Font ascent/descent determine the baseline; half of the extra leading goes above
and below. Each line combines its runs' extents around a common baseline, with the
Text style providing a minimum strut. A small line height allows ink to overflow;
glyphs keep their font size. Text exposes `baseline` and `last_baseline`; its plain
`Line` fragments expose individual baselines. Lines are results, not elements
reconstructed during measurement.

Text preparation normalizes runs, identifies legal breaks across span boundaries,
and measures each break unit. Reflow only packs those advances into lines. Kerning
and ligatures apply within each uninterrupted style/break unit; shaping across
different styles or break boundaries is deferred. Equivalent adjacent spans merge.
The exact-width regression checks both sides of a break just 1e-9px apart, and a
counting provider verifies that changing width performs no additional shaping.

`Fonts` is a small adapter around Fontkit and the existing bundled font files. It
replaces the old font registry without importing the old Env or text layout.
Fontkit handles Plex's extension kerning tables, which the old OpenType library
skips. One adapter-local workaround gives empty TrueType glyphs zero bounds: Fontkit
2.0.4 otherwise reads past the end of Plex Mono's glyph table for spaces. Neither
font files nor global library prototypes are modified.

Each pass supplies its own lazy `fonts` resource. Bun/Node loads bundled files on
first use; importing the module does no file I/O. Other hosts can preload with
`await fonts.load()`, register font bytes, or provide a different measurement
implementation. Browser asset packaging is deferred; no installed/system font is
required by the resulting SVG.

```ts
import { Fonts, LayoutPass } from 'gum-next-core';

const fonts = new Fonts();
fonts.register('My Font', font_bytes, { weight: 400, style: 'normal' });
const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } });

// After later registrations, explicitly invalidate any reused pass:
pass.set_resource('fonts', fonts, fonts.version);
```

The replaceable `FontProvider.resolve(family, weight, style)` returns ascent,
descent, and `shape(text)`. Metrics use em, with positive ascent/descent distances;
shapes contain an advance, immutable outline commands, and ink in y-down coordinates
at a one-em font with baseline zero. Font resources and preparation caches belong to
the pass, and source elements contain no resource objects.

**SVG text is currently outlined.** The same measured glyphs become pixel paths,
so SVG and PNG agree without installing or embedding fonts. Text retains an escaped
accessible label. Outlines make output larger and text is not selectable/searchable
as native SVG text; an optional native-text rendering route can be added later.

## Shapes and paths

Rect, RoundedRect, Ellipse, Line, Polyline, Polygon, and Path have no default aspect
ratio. Each axis fills its available space unless a preferred dimension or min/max
limit specifies otherwise. Square and Circle instead prefer 1:1. Any shape can
specify an explicit preferred `aspect`.

```jsx
<Svg width={px(200)} height={px(100)}>
  <Rect />
</Svg>
```

Rect fills the full 200×100 viewport; Ellipse does the same with radii 100×50.
Square and Circle measure 100×100 under that offer. Two exact axes may allocate
them a nonsquare frame, in which their geometry remains inscribed. An unoffered
axis on an aspectless shape uses 16px: `<Rect width={px(60)}/>` naturally measures
60×16, while `<Square width={px(60)}/>` measures 60×60. With neither axis offered,
all defaults remain 16×16. Empty polylines and paths paint nothing but retain the
ordinary shape sizing policy.

| Element | Geometry props and defaults |
|---|---|
| `Rect` | `radius` defaults to zero; a scalar uses the shorter side, `{x,y}` resolves per axis. |
| `Square` | Same props as Rect; centered square geometry with side equal to the shorter allocation axis. |
| `RoundedRect` | Same props, with a default radius of 0.125 of the shorter side. Radii clamp to half the corresponding dimension. |
| `Circle` | `center: {x: 0.5, y: 0.5}`, scalar `radius: 0.5` of the shorter side. |
| `Ellipse` | Same center, `radius: {x: 0.5, y: 0.5}`. |
| `Line` | `from: {x: 0, y: 0}`, `to: {x: 1, y: 1}`. Fill is ignored. |
| `Polyline` / `Polygon` | `points: [{x,y}, ...]`; Polygon closes the path. |
| `Path` | `commands` from the absolute path helpers below. |

Point inputs accept `{x,y}` or `[x,y]`, including mixtures in a list. This applies
to endpoints, centers, paired radii, plot marks, field vectors, and curve/coordinate
helpers. Tuples can mix fractions, px, and em wherever length coordinates are
allowed: `<Line from={[px(12), 0.5]} to={[1, 0.5]} />`. `zip(xs, ys)` can be passed
directly as `points`. Callbacks and generated geometry retain named `{x,y}` records.
TypeScript exports `PointValue` for numeric inputs and `PositionValue` for lengths;
`Point` and `Position` remain record types. See the
[point values reference](../gum-next-docs/topics/text/PointValues.md) and its runnable example.

```jsx
<Path width={px(120)} height={px(60)} stroke_width={px(2)}
  commands={[
    move_to(0, 0.5),
    curve_to(0.25, em(-1), 0.75, 1, 1, 0.5),
    line_to(px(10), 1), close_path(),
  ]} />
```

Path helpers are `move_to(x,y)`, `line_to(x,y)`, `quad_to(x1,y1,x,y)`,
`curve_to(x1,y1,x2,y2,x,y)`, and `close_path()`. A nonempty path starts with a move.
The first API uses structured absolute commands, without SVG string parsing,
relative commands, or arcs. Each coordinate accepts fractions, `px()`, or `em()`;
negative and out-of-frame coordinates are valid and contribute overflow.

Shape defaults are `fill="none"`, `stroke="black"`, and `stroke_width={px(1)}`.
Strokes straddle geometry, including rectangle edges; they do not consume layout
space. `stroke_linecap` accepts butt/round/square; `stroke_linejoin` accepts
miter/round/bevel; `stroke_miterlimit` defaults to 4. Curve ink uses a conservative
control hull enlarged for caps/joins. Text instead supplies precise glyph ink.
Zero-area rectangles/ellipses paint nothing; a zero-length round-capped line can
paint a dot. Pixel strokes remain fixed when the layout box changes. An explicit
placement transform still scales the completed drawing, including its strokes.

## Math and data helpers

Numeric helpers are shared by named imports and the JSX evaluator. Use `sin`,
`cos`, `exp`, and `sqrt` directly in formulas or as sampling callbacks. The
original public utility set is available alongside additional Math aliases,
`lerp`, and `tau` (2 pi).

| Group | Reference and examples |
|---|---|
| Scalars, reductions, interpolation | [Math helpers](../gum-next-docs/topics/text/MathHelpers.md): sin/cos, log/exp, sum/mean, norm, clamp, rescale, sigmoid, rounder |
| Sequences and arrays | [Arrays](../gum-next-docs/topics/text/Arrays.md): range, linspace, zip, enumerate, repeat, meshgrid, lingrid, reshape, split, concat, slice |
| Vector and complex arithmetic | [Vectors](../gum-next-docs/topics/text/Vectors.md): polar/polard, add2/sub2/mul2/div2, N-dimensional equivalents, addc/subc/mulc/divc, conjc/normc/argc |
| Color interpolation | [Colors](../gum-next-docs/topics/text/Colors.md): interp, palette |
| Reproducible samples | [Random](../gum-next-docs/topics/text/Random.md): setSeed, random, uniform, normal, integer, RNG |

`range` excludes its stop; `linspace` includes its endpoint by default and keeps
the existing 101-sample default. Pass false as its fourth argument for periodic
data. Counts and generated grid sizes are bounded at 100000. Generated arrays
and points are frozen without freezing caller-owned objects.

`polar` and 2D arithmetic return native `{x,y}` points. Array reductions `min`
and `max` accept arrays; `minimum` and `maximum` accept separate arguments.
All skip null/undefined. Empty min/max return undefined and empty mean returns NaN.

Each `evaluate` call owns a fresh random stream, defaulting to seed 42; pass
`{seed: 7}` or call `setSeed(7)` in JSX to choose another sequence. Direct imports
share a separate host stream; `new RNG(seed)` creates an independent one.
`integer` excludes its upper bound. Layout and rendering never consume random
samples, so resizing preserves the data. See the
[migration notes](../gum-next-docs/topics/text/Migration.md#numeric-helpers) for
differences from the original helpers.

## Graphs and plotting

```jsx
<Svg width={px(640)} height={px(400)}>
  <Plot title="A sampled curve" xlabel="x" ylabel="sin(x)"
    xlim={[0, tau]} ylim={[-1.2, 1.2]} background="white">
    <SymLine fy={sin} xlim={[0, tau]}
      stroke={blue} stroke_width={px(2)} />
  </Plot>
</Svg>
```

Graph infers linear data limits from graphable children. Plot adds axes, a grid,
measured margins, titles, and an optional legend. Both accept xlim/ylim or
coord=[xmin,ymin,xmax,ymax], independent flips, and data-range padding. Directed
limits can reverse either axis; explicit limits remain exact. Empty data uses
[0,1]; constant data expands to a finite span. Both fill finite offers, naturally
measure 480×320, and derive a missing axis from a 1.5 default aspect.

New marks interpret numeric geometry as data inside Graph/Plot and as fractions
outside. `space="local"` opts out; `space="data"` requires a graph. Existing
Line/Polyline/Path retain local geometry; use CoordLine for a graph path. px/em
positions stay local. Graph directly positions annotations by data x/y and
ordinary anchor metadata. Text remains upright; widths and fonts remain lengths.

| Capability | Elements / reference |
|---|---|
| Curves, points, fills, arrows | CoordLine, Points, Spline, RoundedLine, Segments, Arc, Ray, Fill/HFill/VFill, Arrow, ArrowHead |
| Plot composition | [Plot](../gum-next-docs/elements/text/Plot.md), Graph, Legend, OuterLabel |
| Axes and grid | Axis/HAxis/VAxis, Scale, Label/Labels, Mesh/Mesh2D and directional variants |
| Bars | Bar/VBar/HBar, Bars/VBars/HBars, BarPlot |
| Sampling | [Sampling](../gum-next-docs/topics/text/Sampling.md), SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField |
| Composition | Overlay, Anchor, Attach, Rotate, TransformBox |
| Text and slides | TextStack/Row/Col, TextBox/Frame, TextFigure, Bullets, TitleBox/Frame, Slide |

`Attach` uses `at` to select a point along the content edge and `attachment_anchor`
to select the attachment's own point along that edge; both default to 0.5. The
wrapper's own `anchor` remains independent. Use `attachment-anchor` in JSX or
`attachment_anchor` in host props; this replaces the earlier `Attach.align` name.

Arrow shafts retreat at headed ends to hide the cap behind the triangular tip.
Clearance uses the resolved shaft stroke, cap style, and head width after data
mapping. Original head tips, unheaded endpoints, and inferred limits stay fixed.
Short terminal segments are consumed without reversing the shaft; if the whole
route is consumed, only the heads remain. Field arrows share the same rule.
See the [cap comparison](examples/arrow_caps.jsx) for thick straight, curved, and
rounded arrows.

Tick counts are targets using 1/2/5 intervals. Explicit ticks may be numbers or
[value,label] pairs. Plot accepts scoped props such as `axis_stroke`,
`xaxis_label_color`, and `title_font_size`, alongside nested part style objects
and per-axis option objects. It reserves space from measured axis overflow and
title sizes. Data clips by default; axes and labels remain outside that clip.
Standalone axes/meshes require their own lim for tick generation.

Sampling, marker-shape/size functions, bar styles, and tick formatters run once
at construction and produce immutable descriptions. Resizing reuses samples and
prepared glyph measurements. Null/nonfinite samples create path gaps. Use fy for
y=f(x), fx for x=f(y), f(t) for parametric points, or explicit arrays. samples
defaults to 101. SymFill takes upper/lower functions or constants; SymField
samples a grid and maps vector directions before drawing fixed-size heads.

The public linear_ticks, linspace, sample_curve/sample_points, spline1d/spline2d,
and [coordinate helpers](../gum-next-docs/topics/text/Coordinates.md) can also be
used directly. `static normalize(input)` consumes raw input once before source
defaults are merged; `Element<SourceProps, InputProps>` types the two separately.
The same hook is available through define_element's fourth options argument.
define_component adopts another element's source
description without a layout wrapper. Neither stores callbacks in source data.

This is a basic linear plotting API. Log/date scales, label collision avoidance,
adaptive sampling, grouped/stacked bar automation, and advanced arrowheads
remain deferred. Splines can overshoot samples; a
sampler cannot identify discontinuities between two finite samples. See the
[overview](../docs/PLOTTING.md) and [gallery](examples/README.md) for decisions,
examples, and current limits.

## Scoped component props

Compound elements accept prefixed props for their generated parts. JSX accepts
dashes or underscores; direct JavaScript uses underscores:

```jsx
<Plot title="Measurements" axis-stroke={slate}
  xaxis-tick-size={px(8)} xaxis-label-color={blue}
  title-font-size={em(1.4)} title-wrap={false} />
```

| Owner | Scopes | Accepted part options |
|---|---|---|
| Arrow | `head_` | StyleSpec; `head_size` and `head_width` keep their geometry meanings |
| Axis, Scale, Label, Labels and directional variants | `line_`, `tick_`, `label_` | Line/tick styles; label TextOptions |
| Plot, BarPlot | `axis_`, `xaxis_`, `yaxis_` | Axis props, including nested scopes such as `xaxis_label_color` |
| Plot, BarPlot | `tick_`, `label_`, `title_`, `xlabel_`, `ylabel_` | Tick styles and generated text options |
| Plot, BarPlot | `grid_`, `xgrid_`, `ygrid_`, `legend_` | Mesh/Legend options, including `legend_label_font_size` |
| Legend | `label_` | Generated label TextOptions |
| TitleBox, TitleFrame, Slide | `title_` | Generated title TextOptions |
| TextFigure | `caption_` | Generated caption TextOptions |

TextOptions includes styles, sizing, wrapping, whitespace, and text alignment;
the owner supplies the text content. Existing `*_style` objects remain supported
and accept the same options. Flat props override matching fields of the nested
object at that scope. Plot merges common tick/label settings, common axis settings,
the `xaxis`/`yaxis` option object, then the corresponding flat axis props. Part
option records merge per field, preserving unrelated shared settings. Shared grid
and label settings similarly supply defaults for x/y overrides. An explicit
`xaxis={false}` stays disabled even when scoped props are present. Plot owns axis
and grid domains; explicit `xticks`/`yticks` take precedence over axis tick options.

Routing runs during construction, preserving source and child identities on
resize. Supplied Element titles, captions, tick labels, and legends retain their
own descriptions; scopes configure generated parts. Owner props such as
`line_height`, `tick_size`, `label_offset`, and `label_gap` retain their meanings.

`prefix_split(prefixes, props, keep?)` and `prefix_join(prefix, props)` are public
helpers and JSX bindings for custom components. Splitting returns one object per
prefix, followed by the remaining props, without mutating the input. The longest
matching prefix wins; optional exact `keep` keys stay in the remaining props.
Joining adds a prefix to each key. Values remain unmodified, including units and
callbacks. `Prefixed<'label', TextOptions>` derives the corresponding TypeScript
prop names and value types. See [Custom elements](../gum-next-docs/topics/text/CustomElements.md).

Scopes are constructor-input syntax. `static defaults` still contains canonical
source props and merges after normalization; for example Arrow defaults use
`head_style`, not `head_fill`. Defaults that affect generated children belong in
a component or normalizer, before those children are constructed.

## Rendering and inspection

`render_svg(fragment, { title?, background?, id_prefix? })` consumes only fragments.
It emits escaped SVG, resolved drawing geometry, explicit placement transforms,
and rectangular clip definitions. Identity placements and attribute-free fragment
groups are omitted; transforms, clipping, and accessible labels retain their groups.
The fragment tree remains intact for layout and inspection. Rendering performs no
layout or font work. Definition
IDs are allocated per render and reused for repeated placements of a shared clip;
speculative layout queries cannot consume IDs. Supply distinct `id_prefix` values
when embedding several generated documents inline in one page.

`inspect_fragment(fragment)` prints local sizes, content rectangles, offsets,
matrices, ink, overflow, and guides. The CLI's `tree` format uses it; `json` exposes
the complete result.
The renderer uses the fragment's allocated size directly as both SVG dimensions
and viewBox extent. Ordinary resizing relays a new request through the layout pass;
only an explicit placement matrix scales completed geometry and strokes.

## Contributor notes

Work in this standalone git repo, moved from the original core's `src/next`.
Inspect `git status` here before editing. Checkpoints are kept by the maintainer;
commit when asked. Keep this implementation isolated until a separate migration
decision. The legacy Env, math/plotting elements, and add-on packages continue
to use the old core.

The workspace's `gum-next-cli` targets this implementation. A globally installed
legacy `gum` and the legacy documentation or authoring skills still target the
old API. Run `bun install` at the workspace root to link the packages. No build
is needed to run TypeScript sources. JSX examples are read as source by
`evaluate`, so they do not need React or its JSX runtime.

| Responsibility | Start here |
|---|---|
| Length syntax, reference resolution, and defaults | [units.ts](./src/units.ts), [defaults.ts](./src/defaults.ts), [style.ts](./src/style.ts) |
| Requests, shared sizing, and geometry | [layout.ts](./src/layout.ts), [geometry.ts](./src/geometry.ts), [composition.ts](./src/composition.ts) |
| Immutable descriptions and element factory | [element.ts](./src/element.ts) |
| Queries, caches, resources, and diagnostics | [pass.ts](./src/pass.ts) |
| Box, root Svg, and explicit fitting | [box.ts](./src/box.ts), [elems.ts](./src/elems.ts) |
| Stack queries versus pure flex allocation | [stack.ts](./src/stack.ts), [flex.ts](./src/flex.ts) |
| Positioned canvas and direct-child metadata | [group.ts](./src/group.ts) |
| Text preparation/reflow and font adapter | [text.ts](./src/text.ts), [fonts.ts](./src/fonts.ts) |
| Shapes, path commands, drawing, and immutable results | [shapes.ts](./src/shapes.ts), [path.ts](./src/path.ts), [drawing.ts](./src/drawing.ts), [fragment.ts](./src/fragment.ts) |
| Public API and JSX names | [index.ts](./src/index.ts), [eval.ts](./src/eval.ts) |
| Rendering and debugging | [svg.ts](./src/svg.ts), [inspect.ts](./src/inspect.ts) |
| Command-line I/O | [gum-next-cli](../gum-next-cli/README.md) |
| PNG conversion | [gum-next-png](../gum-next-png/README.md) |

“Keep the layout pass ice cold.” Add container behavior to the container or a pure
helper. Shared ElementProps includes flex and position metadata for typing; their
presence does not make them engine policies. Extend `Element` for new primitives,
keep source data immutable, and place the returned fragments. Opaque objects and
font providers belong in pass resources. No measuring in constructors, rebuilding
children during queries, implicit margin wrappers, or layout inside the serializer.

Keep `query.request`, `query.reference`, and `query.style` distinct. Pass child
references explicitly; omitted references are indefinite. Exact allocations override
preferred dimensions and min/max, but source sizing still has to resolve first.
Do not round widths to improve cache hits: text break boundaries are observable.
`query.prepare()` may depend on source, resolved style, and resources, never the
current request, reference box, coordinate context, or path. Resource revisions
invalidate the pass's layout and preparation caches. Reuse source identities to reuse fragments; equal
props on two newly constructed elements do not give them a shared cache entry.

When adding a public element, export it and its types in `src/index.ts`, add its JSX
binding in `src/eval.ts`, and wire relevant checks into `test/run.ts`. Add concise
examples to `scripts/gallery.ts` and regenerate their SVG/PNG/tree artifacts;
inspect both the images and numerical trees. The early custom placement fixtures
are intentional protocol examples, while new composition examples should use the
standard elements. Update this README, the gallery README, and roadmap status.

For runtime changes, run `bun run test` and `bun run typecheck` here. The core suite
covers contracts and layout. The workspace's `bun run test` runs this core suite.
The suite also covers plotting, sampling, numeric helpers, mixed point inputs,
and composition behavior.
For public type changes, also verify
declaration emission into a scratch directory:

```sh
bun tsc --noEmit false --declaration --emitDeclarationOnly --outDir /tmp/gum-next-types
```

The checked-in gallery can be regenerated with `bun scripts/gallery.ts` here
(`rsvg-convert` is required). Use `pass.stats` and counting font providers for
measurement-cost regressions. Natural hugging and Group examples generally query
each child once; flex/reflow/stretch may require additional queries. Counted layouts,
cache hits, and prepared glyph reuse are distinct. Preserve the opposing-clamp and
text-width-boundary cases when changing allocation. See the
[roadmap style guide](../docs/ROADMAP.md#style-guide) for the project's implementation style.
