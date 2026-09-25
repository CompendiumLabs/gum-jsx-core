# Core API reference

Detailed layout and rendering contracts for `@gum-jsx/core`. For setup and a
first example, see the [package README](./README.md).

- [Lengths and references](#lengths-and-references)
- [Requests and size selection](#requests-and-size-selection)
- [Insets and fragments](#insets-and-fragments)
- [Elements and layout passes](#elements-and-layout-passes)
- [Box composition](#box-composition)
- [Stacks](#stacks)
- [Grids](#grids)
- [Positioned groups](#positioned-groups)
- [Text and fonts](#text-and-fonts)
- [Shapes and paths](#shapes-and-paths)
- [Math and data helpers](#math-and-data-helpers)
- [Graphs and plotting](#graphs-and-plotting)
- [Networks](#networks)
- [Scoped component props](#scoped-component-props)
- [Rendering and inspection](#rendering-and-inspection)
- [Contributor notes](#contributor-notes)

## Lengths and references

Length properties accept fractions as raw numbers, explicit `em()` / `px()`
values, and unit strings such as `"1.5em"`, `"24px"`, and `"50%"`.
Percent strings normalize to fractions; bare numbers retain
their existing meaning. The unitless string `"0"` is also accepted. Helpers and
normalized values are immutable; normalization copies input
objects. Negative lengths are valid for coordinates. Sizing and inset operations
require nonnegative resolved values.

```ts
import { em, px, make_measure, resolve_length, measure_length } from '@gum-jsx/core'

const measure = make_measure({ font_size: 16 })
resolve_length(0.5, measure, 200) // 100 pixels
resolve_length('50%', measure, 200) // 100 pixels
resolve_length(em(2), measure)  // 32 pixels
resolve_length(px(10))          // 10 pixels

measure_length(0.5)             // { value: 0.5, unit: 'fraction' }
resolve_length(0.5, measure, 0)  // 0 pixels: a known zero reference
resolve_length(0)               // 0 pixels: no reference needed
```

`measure_length` preserves an unresolved dependency for an intrinsic query.
`resolve_length` is the final-layout operation: an unresolved nonzero length throws
`UnresolvedLengthError`, with its length and source property path. It never guesses
a percentage reference from an offer. A caller can resolve a retained value again
once its reference becomes definite. General percentage cycles are deferred.

Length helpers share the immutable `LengthContext` at `query.measure`, containing
`font_size`, `reference: { width?, height? }`, and a diagnostic `path`.
`make_measure(context, patch)` derives local changes while preserving the other
fields. `resolve_sizing` and `resolve_insets` select percentage axes: width and
horizontal insets use reference width; height and vertical insets use reference
height. The reference is the parent's established content box before flex slots
are allocated. Deflating an offer does not change that reference.

Width and height additionally accept `"fill"`. Fill occupies an available dimension,
clamped to own limits, and falls back to ordinary measurement without an offer.
Omitted dimensions use ordinary measurement; text still wraps at its available
width. Use `align_self` to opt out of parent fill alignment. Fill is a sizing
policy, not a length.
`resolve_sizing` accepts an optional `request` as its third argument to resolve fill from
the actual parent offer. The layout pass supplies it automatically. Resolving fill
once keeps an own maximum from turning natural measurement into a full-width request.

Resolve `font_size` first using `resolve_font_size(value, inherited_measure)`.
Its em and percentage forms refer to the inherited font size. Subsequent em lengths and line height
use the resolved local font size. Defaults live in [defaults.ts](./src/engine/defaults.ts):
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

`make_request()` defaults both axes to natural, and treats `undefined` or `null`
axes as omitted so optional dimensions forward without conditional spreads.
Numeric requests must be finite and nonnegative; zero is an exact value, not an
absent dimension.

```ts
import {
  available, make_request, resolve_sizing, prepare_request, finish_size, make_size,
} from '@gum-jsx/core'

const context = { reference: { width: 640 }, path: 'root/child' }
const sizing = resolve_sizing({ width: 0.5 }, context)
const request = make_request({ width: available(400) })
const prepared = prepare_request(request, sizing) // width: exact(320)

// A real element would measure its content using `prepared` here.
const content = make_size(300, 20)
const size = finish_size(content, prepared, sizing) // 320×20
```

Use the same resolved sizing for preparation and completion. Preparation and
completion are pure, and preparation is idempotent. They do not measure, reflow,
or scale content themselves.

The precedence is:

1. An incoming exact allocation wins over preferred dimensions and min/max limits.
2. Otherwise an explicit dimension, clamped to its own min/max, becomes exact.
3. Otherwise available space is clamped to min/max before measuring. A natural
   request with a finite maximum becomes an available offer at that maximum.
4. An explicit `aspect` derives a missing axis from an exact dimension or equal
   min/max limits before layout. The derived axis is clamped to its own limits;
   two established axes take precedence over the preferred ratio.
5. Completion clamps measured dimensions to min/max; it does not clamp them to
   advisory offers. With neither axis established, an explicit aspect adds space
   to the measured box to reach the ratio, subject to limits. An exact axis always
   reports its allocation.

`resolve_sizing` requires definite bases even for a preferred dimension that a
later exact allocation overrides. Missing references and invalid min/max ranges
are errors in the source sizing policy. An omitted maximum is represented by
`Infinity` in the resolved policy only; allocated geometry is always finite.

`shape_size` fills offered axes independently when no aspect is specified. An
unoffered axis uses the 16px natural fallback, independently of the other axis.
Preferred dimensions and min/max limits apply through the shared sizing policy.

`aspect` is a shared Element sizing property: a positive finite width/height
ratio of the complete allocated box. Text, stacks, Svg, math, and custom elements
use the same `prepare_request`/`finish_size` rules as frames and shapes. A known
axis derives the other before reflow and child allocation; a wholly content-sized
element grows its measured allocation to the ratio. Contents are not scaled.

Shape-specific measurement still supplies a natural size or fits advisory offers.
An explicit aspect, or the intrinsic 1:1 aspect supplied by Square and Circle,
preserves that ratio while fitting those offers; with two natural axes, shapes use
the default height. Intrinsic ratios stay local to their elements and are not
inferred from a container's children. Explicit dimensions and limits can override
both intrinsic and explicit preferred ratios.

## Insets and fragments

`resolve_insets` accepts a uniform length or these shorthand forms. Each value
accepts the helper and string forms above; fractions and percent strings resolve
against the corresponding axis.

| Form | Meaning |
|---|---|
| `{ top, bottom, left, right }` | Individual side lengths. |
| `{ t, b, l, r }` | Short names for the same sides. |
| `{ h, v }` | Horizontal (left/right) and vertical (top/bottom) lengths. |
| `[h, v]` | Two-entry horizontal/vertical tuple. |
| `[t, b, l, r]` | Four-entry top/bottom/left/right tuple. |

Object forms may be mixed: full side names override short names, which override
`h`/`v`. Missing sides default to zero; an explicit zero overrides a broader
default. Tuple order follows Gum, not CSS, and arrays require exactly two or four
lengths. Inputs are not mutated. Deflation floors inner dimensions at zero;
inflation preserves the full inset extent, including when it cannot fit.

Box dimensions denote the border box, including padding and border. Padding and
border deflate the child's space. External spacing is another Box's padding;
each layer owns its size, style, and child reference box.

The [fragment schema](./src/engine/fragment.ts) contains only the result for one request:

- `size`: the allocated rectangle, based at the local origin.
- `content`: optional usable content rectangle; Box exposes the space inside its insets.
- `guides`: optional named vertical pixel positions, including `baseline` from the top.
- `ink`: painted bounds after clipping, or `null` for no paint.
- `overflow`: nonnegative excess content on each side, recorded before clipping.
- `outset`: optional space reserved outside the allocation by frame-bounded elements, such as
  a `bounds="frame"` plot's labels. It is declared rather than measured from ink, propagates
  through placements up to a clip, and a hugging `Svg` viewport grows to include it.
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
<Svg width={px(240)} height={px(120)} font-size={px(20)}>
  <Rect width={0.75} height={em(3)} fill="#49a895" stroke="none" />
</Svg>
```

Named constants are available both in evaluated JSX and as imports from
`@gum-jsx/core`: `sans`, `mono`, `light` (300), `regular` (400), `bold` (700),
`none`, `white`, `black`, `blue`, `red`, `green`, `yellow`, `purple`, `gray`,
`lightgray`, `darkgray`, `slate`, and `e`, `pi`, `tau`, `phi`, `r2d`, `d2r`.
For example, `<Text font-family={sans} font-weight={bold} color={blue}>Hello</Text>`.
Colors use the original Gum palette; see the
[style reference](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/style.md) for their exact values.

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

`evaluate_prelude(code, { scope?, name?, seed? })` evaluates declarations and returns
their top-level bindings. Pass them in `evaluate`'s `scope` to share data and JSX
helpers across figures. Each call runs the prelude once; reuse the returned
bindings to retain shared objects and closures. Prelude evaluation includes the
same built-in helpers as `evaluate`.

`new Evaluator({ scope?, name?, seed? })` configures reusable bindings and defaults.
Its `evaluate(code, options?)` and `evaluate_prelude(code, options?)` methods accept
the same `EvaluateOptions` as the standalone functions. Core bindings are always
included; constructor scope overrides core bindings, and per-call scope overrides
constructor scope. A binding explicitly set to `undefined` still overrides an
earlier value. Local declarations can shadow any supplied binding.

```ts
import { Evaluator } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'

const evaluator = new Evaluator({ scope: math })
const shared = evaluator.evaluate_prelude(`
  function Formula({ expression }) {
    return <Latex>{expression}</Latex>
  }
`, { name: 'prelude.jsx' })
const source = evaluator.evaluate('<Formula expression={expression} />', {
  name: 'figure.jsx',
  scope: { ...shared, expression: 'a+b=c' },
})
```

The readonly `scope`, `name`, and `seed` properties expose the configured values.
The constructor makes a shallow, frozen copy of the binding map. Replacing a
binding in the original map does not change the evaluator, but supplied objects
and closures are shared by reference. Evaluation does not persist local bindings
or automatically install prelude declarations.

Each call starts an independent random stream. Omitted or `undefined` per-call
`seed` and `name` use the constructor defaults. Without a configured seed, the
seed is 42; without a configured name, evaluation uses `gum.jsx` and prelude
evaluation uses `prelude.jsx`. Calling `setSeed` inside evaluated code affects
that call's stream only. A closure returned from a prelude can retain that
prelude's stream, just as it retains other local state.

Standalone evaluation functions delegate to a private, core-only evaluator.
Creating an evaluator or importing an extension package does not change their
bindings. Evaluators perform no font loading, layout, or rendering.

`Svg` accepts one content element and optional pixel width and height, written as
`px(800)` or `"800px"`. Each
omitted axis hugs the child's measured allocation, including any surrounding Boxes.
A fixed width with an omitted height supports reflowing documents; omitting both supports
fully natural composition. An exact request can resize either axis. Established
axes become child percentage references and available-space offers. A hugging
axis remains indefinite during measurement; its final size is never fed back as
a percentage basis. An empty unsized Svg is 0×0.

On hugging axes, `max_width` and `max_height` first provide layout offers, then
uniformly scale down the completed figure if it exceeds either maximum. Both
dimensions shrink together, including fonts, strokes, guides, and reserved
outsets. Small figures are not enlarged. This lets preview hosts bound a figure
without cropping it. An exact axis still keeps its allocation and clipping;
ordinary `available()` offers alone never trigger scaling. Width-only rendering
therefore retains normal reflow and natural height. Other elements' max props
continue to constrain their allocations without scaling their content.

The viewport follows layout bounds, not ink, and clips overflow at its edges.
An unsized `Rect` fills both available viewport axes. Its stroke straddles its
geometry, so half the stroke extends outside the layout rectangle; the fragment records that
ink and overflow. An empty or zero-area rectangle paints nothing. Box borders
instead consume layout space and stay entirely inside their border box.

The same source can answer different allocations without being rebuilt:

```ts
import { Rect, Svg, px, em, LayoutPass, make_request, exact, render_svg }
  from '@gum-jsx/core'

const tile = new Rect({ width: 0.5, height: em(2), stroke_width: px(2) })
const scene = new Svg({ width: px(160), height: px(80), children: tile })
const pass = new LayoutPass()
const first = pass.layout(scene) // child: 80×32, 2px stroke
const second = pass.layout(scene, make_request({
  width: exact(320), height: exact(120),
}))                            // child: 160×32, 2px stroke
const svg = render_svg(second)
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
  }
}
const tile = new SmallRect({ width: px(48) })
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
data bounds; see [Custom elements](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/custom_elements.md).
The layout function receives readonly props and a frozen query:

| Query field | Meaning |
|---|---|
| `request` | Prepared pixel requests, including explicit preferred dimensions. |
| `sizing` | Resolved preferred sizes, min/max, and aspect. |
| `style` | Inherited font and paint; font size is resolved, relative line height and stroke width retain their units. |
| `measure` | Shared font size, established parent reference, and diagnostic path for length resolution. |
| `child(element, request, reference?, index?)` | Query a child with inherited style and its own path. |
| `resource(name)` | Read a pass-owned resource during measurement. |
| `prepare(name, compute)` | Cache source/style/resource work independently of requests and parent references. |

Pass a child's percentage reference explicitly once the container establishes its
own content box. Omission leaves the reference indefinite. A finite available offer
alone does not establish that box.

`child(...)` and `pass.layout(...)` return the element's own layout result. The
pass resolves shared style and sizing, runs the layout method, validates its size,
and caches the fragment. Insets, placement, and decoration belong to elements.
Element-specific properties are interpreted by the element's layout method.
The direct stack parent interprets a child's `basis`, `grow`, and `shrink`.
Stacks, grids, and single-content containers interpret `align_self`; these placement
properties introduce no policy in the layout pass and do not inherit.
Similarly, Group reads its direct children's `x`, `y`, and `anchor`. These properties
do not move elements inside Box or a stack, or acquire behavior in LayoutPass.

Set `debug` on an element to outline its allocated box in solid red and its
content box, when provided, in dashed blue. The flag applies only to that element;
children can opt in separately. SVG output draws the boxes above the artwork,
following placement transforms and bypassing content clips within the viewport.
These diagnostics do not change layout, ink, or overflow and also appear in PNG
and terminal output. See [Debugging layout](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/rendering.md#debugging-layout).

A layout method finishes its measured size with `finish_size` or `shape_size`, then
returns `make_fragment(...)`. The pass validates its result against the request and
size policy; an incorrect exact size is an error. Fixed content can draw its natural
geometry inside a smaller allocated frame and record overflow. See the synthetic
[fixed, expanding, and wrapping leaves](./test/fixtures/leaves.ts) and the custom parent
in [repeated.jsx](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/code/repeated.jsx). These fixtures exercise custom layout
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
  <Box padding={em(1)} border-width={px(2)}>
    <Square width={px(64)} fill="#63b49d" stroke="none" />
  </Box>
</Svg>
```

Square reports 64×64. Box adds 16px padding and a 2px border on each side; Svg
adopts its 100×100 result. Each element receives one layout query. See the
[Box](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Box.md) and
[Frame](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Frame.md) examples for related composition.

Box has at most one content element; put text in an ordinary `Text` child. It
hugs measured content unless its own sizing or an exact request fixes an axis.
An available width is passed inward for reflow, without scaling glyphs or strokes.
The shared `layout_content` operation deflates the request, queries the child,
inflates its answer, selects the final size, and aligns the completed fragment.
Svg uses the same operation with no insets. Neither reconstructs source elements.

| Prop | Meaning |
|---|---|
| `width`, `height`, `min_width`, etc. | The shared sizing policy, applied to the border box. |
| `aspect` | Optional preferred width/height ratio of the border box. |
| `padding` | Length, side/axis object, or `[h, v]` / `[t, b, l, r]`; default zero. |
| `border_width` | Uniform length occupying space inside all four edges; default zero. |
| `border_color` | Border paint; defaults to the resolved text `color`. |
| `background` | Local fill behind the content; default `"none"`. |
| `border_radius` | Rounded outer corners; scalar, `{x,y}` / `[x,y]` pair, or side/corner object, default zero. Clamped to the box. |
| `align` | `"start"`, `"center"`, `"end"`, `"fill"`, `"stretch"`, or a number from 0 to 1; also accepts `{x,y}` or `[x,y]`. Default start on both axes. |
| `clip` | Clip the child inside the border, including the padding area; default false. |

Background and border are local decoration. Ordinary `fill`, `stroke`, and font
props still inherit to children. `Frame` is Box with a default 1px border.
The border paints above the child, wholly inside the frame, even when thicker
than half the box. Its drawing construction introduces no extra ink overflow.

Box and Frame honor an explicit `aspect`: `width={px(200)} aspect={1}` makes a
200×200 frame, with padding and border inside. One established axis derives the
other before child layout; two fixed axes and min/max limits take precedence.
Without an established axis, measured content grows to the ratio without scaling
the child or treating an advisory offer as a fill instruction.

For TitleFrame, generic `aspect` includes the raised title, just as width and
height do. Use `frame_aspect` for the bordered body instead: `width={px(480)}
frame-aspect={1}` gives a square border and adds the title overhang automatically.
Explicit outer allocations, including those derived from `aspect`, take precedence
over the body's preferred ratio.

Radius objects use `t`, `b`, `l`, `r`, `tl`, `tr`, `bl`, and `br` (bottom-right).
For example, `border-radius={{ t: px(8) }}` rounds only the top corners;
`border-radius={{ t: [px(12), px(6)], tr: 0 }}` leaves only the top-left corner rounded.
Entries accept the same scalar lengths and elliptical pairs as uniform radii.
Unspecified corners are square. Explicit corners override sides, and `t`/`b`
override `l`/`r` at shared corners, independently of object order. Each axis is
capped at half its dimension. Backgrounds, borders, and inner clips share the
same corners. Rect, RoundedRect, Square, and bars accept these forms too.
On bars, sides name screen edges; fractions retain the mark allocation as their
reference, with pairs using its width and height independently.

Box resolves em padding and border against its own font size, before querying
the child. Fractional padding uses the corresponding parent content axis.
Fractional border width uses the parent's shorter side, requiring both
axes; it cannot depend on the unresolved size that it helps determine. Radius
is decoration and resolves against Box's final rectangle. Prefer `px()` or `em()`
for border width in a naturally sized tree.

An exact axis, equal min/max limits, or an axis derived from one of these by an
explicit aspect establishes a content reference before measurement.
For example, `<Svg width={px(360)}><Box width={1}>…</Box></Svg>`
gives Box a definite width, then gives its child that width minus padding and
border. Box and Svg can both hug height. A nonzero fractional child height on
that unresolved axis produces a property-path error, without iteration.

Alignment positions the child's allocated box. Numeric alignment is dimensionless:
0 is start, 0.5 center, and 1 end. Stretch sends an
exact child request on axes established before measurement; other axes still
hug. Center/end alignment may give oversized children negative offsets. Baselines
move with the child. Clipping changes visible ink and retains overflow.

Fill uses the established content area but allocates only automatically sized
children, respecting explicit dimensions and min/max limits.
Remaining space stays at the end of a fill-aligned axis. Hard stretch continues
to override child dimensions and limits.

For document layouts, `TextBox` and `TextFrame` default to `align={{ x: "fill" }}`;
`TextCol` defaults to `align="fill"`. All are content-sized by default; set
`width="fill"` at the document boundary to occupy the offered width.
Their existing padding, border, and gap defaults remain. Heights are content-sized,
and flexible row children still require explicit flex weights.
`TextBox` and `TextFrame` forward `text_*` props to generated text children:
`text_justify` sets line alignment, while `text_font_size`, `text_color`, and
`text_wrap` set the corresponding `Text` props.

```jsx
<Svg width={px(400)}>
  <TextBox width="fill" padding={em(1)}>
    <TextCol gap={0}>
      <HStack>
        <Text>Left</Text>
        <Spacer />
        <Text>Right</Text>
      </HStack>
      <Frame>
        <Text>Content</Text>
      </Frame>
    </TextCol>
  </TextBox>
</Svg>
```

Use `align-self="start"` for a compact child inside a fill-aligned container.
Box/Frame children can override either axis with an object (omitted axes inherit),
or both with a scalar/tuple. The child's own `align` still arranges its contents.
`Box`, `Frame`, `HStack`, and `VStack` retain their ordinary sizing defaults.

Use nested Boxes for spacing outside a decorated frame:

```jsx
<Box padding={px(8)}>
  <Box width={px(80)} padding={px(4)} border-width={px(1)}>
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

Fitting is an element prop, separate from allocation. Put it directly on a
formula, text, frame, stack, canvas, or custom element:

```jsx
<Text fit max-width={px(280)} font-size={px(16)}>One fitted line</Text>
```

`fit` measures the element naturally, then uniformly shrinks
it only when needed. It hugs the result, so a larger host adds no blank strip.
`fit="contain"` allows enlargement; `fit="cover"` fills and clips the target.
Those modes occupy finite offered axes; an unoffered axis follows the scaled drawing.

Authored width/height/aspect describe the natural drawing. Parent offers and own
maxima constrain its final fitted size; minima reserve space in the final allocation.
Fill sizing and exact parent allocations can deliberately reserve a larger frame.
`fit_align` defaults to center and accepts the same positions as Box, excluding
fill/stretch. It does not replace `align`, which still arranges the element's children.

The shared layout pass applies fitting, so custom elements need no special code.
Fitting is not inherited. Glyphs, strokes, padding, baselines, math metrics, and
connection geometry scale together. Zero-sized targets are valid. Unchanged
geometry returns without adding a transform fragment. Fitting uses allocated
geometry, not ink bounds; declared outsets follow the transform. Omitted
dimensions use ordinary layout, including text reflow.

Whole formulas from the math package fit finite offers and own maxima automatically.
Internal math allocations and inline formula measurement remain natural.
`fit={false}` disables automatic fitting. Math spacing, rules, and stretch primitives
retain their allocation behavior. A source type's `auto_fit` capability (also
available in `define_element` options) survives protocol adoption by components;
it is not an authored element prop. Resizing reuses the cached natural drawing.

Migration: omit former `width="fit"` / `width="hug"` dimensions; move parent-fill
opt-outs to `align_self` and content-based growth to `basis="auto"`. The `Fit`
element is removed; put `fit` on the content itself. Former `scale_down` or
`fit="shrink"` becomes bare `fit`; use `max_width`/`max_height` for fitting bounds.

## Stacks

HStack packs left to right; VStack packs top to bottom. Both use the same
main-axis/cross-axis implementation. They accept any number of element children,
including arrays, JSX fragments, and conditional children. Empty stacks are 0×0
unless their own sizing or an exact request requires more space.

```jsx
<Svg width={px(400)}>
  <HStack width={1} gap={px(12)} align="center">
    <Text width={px(80)}>Label</Text>
    <Text grow={1} shrink={1}>
      A paragraph gets the remaining width and reflows to find its height.
    </Text>
    <Square width={px(40)} fill="#317969" stroke="none" />
  </HStack>
</Svg>
```

The paragraph receives 256px: 400 minus the 80px label, 40px Square, and two
12px gaps. Its font keeps its size. The row takes the tallest resulting allocation,
and Svg hugs the row's height. See [HStack](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/HStack.md)
for a runnable mixed row; try different viewport widths. For plain JSX text,
outer blank lines and common indentation are removed automatically. Internal
text newlines still become line breaks; keep each paragraph on one content line
or use a string expression child when source formatting should not introduce breaks.

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
| `align` | Cross-axis `"start"` (default), `"center"`, `"end"`, `"fill"`, `"stretch"`, or a number from 0 to 1. HStack also accepts `"baseline"`. |
| `justify` | Main-axis `"start"` (default), `"center"`, `"end"`, a number from 0 to 1, `"space-between"`, `"space-around"`, or `"space-evenly"`. |

Flex and `align_self` properties belong to the **direct child** of a stack. Put
them on an enclosing Box when the Box is the item being allocated; they do not
pass through wrappers.

| Child prop | Meaning |
|---|---|
| `basis` | Starting main-axis length, or `"auto"` to use the explicit dimension/content basis. Omitted follows the rules below. |
| `grow` | Nonnegative weight for surplus space, default **0**. |
| `shrink` | Nonnegative shortage weight, default **0**; multiplied by the original basis. |
| `align_self` | Override the parent's cross-axis `align` for this child. Same values; omitted or `undefined` uses the stack's `align`. |
| `min_width`, `max_width`, etc. | Bounds on the stack's main-axis allocation to this item. |

`align_self` positions the child vertically in HStack and horizontally in VStack.
It is independent of a child container's own `align`, which positions its contents,
and does not inherit. For example, a child can opt out of a stretching column:

```jsx
<VStack width={px(240)} align="stretch">
  <Text>This child receives the column width.</Text>
  <Text align-self="end">This child hugs its text at the right.</Text>
</VStack>
```

The allocator reserves gaps, clamps bases, then distributes surplus or shortage
among participating children. Growth uses `grow`; shrinkage uses `shrink × basis`.
Items reaching limits freeze and the remaining space is redistributed. Zero weights
keep their clamped bases. If maxima prevent filling the frame, `justify` places the
unused space. If minima or zero shrink weights prevent fitting, overflow remains
explicit; the stack does not clip. Wrap it in a Box with `clip` when needed.

An explicit length basis wins. Otherwise the child's explicit main-axis dimension
supplies its basis. If still unsized, positive `grow` starts from zero under an
available or exact main-axis request; natural requests and omitted/zero growth
retain measured bases. An own maximum can supply an available budget, while a
minimum alone retains natural bases before adding surplus.

`basis="auto"` skips the zero fallback and uses an explicit main-axis dimension
or measured content. `width="fill"` supplies no fixed basis. Grow still enlarges
the final allocation, and explicit length bases take precedence. Alignment does
not choose a basis. An explicit `basis={0}` stays zero
even without a budget, where content can overflow a zero allocation.

`grow={1}` gives an unsized item an equal share of remaining space alongside
other such items, subject to limits. `basis="auto" grow={1}` adds equal surplus
to potentially unequal natural bases. See the runnable
[growth bases example](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/code/stack_basis.jsx).
`width={0.5}` instead means half the stack's established width **after
subtracting gaps**, which a stack reserves the way a Box reserves padding. Two
half-width children tile a row with any gap. A fraction used as `basis` or as a
main-axis limit follows the same rule.

Length bases, preferred sizes, and limits resolve using the child's local font size;
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
For children whose effective alignment is `"stretch"`, a definite cross axis
becomes an exact child request. On a hugging cross axis, a column selects its
shared width and remeasures text heights
before allocating vertical space; a row allocates widths and reflows text before
selecting the shared height. Stretch may override a child's preferred cross size
and cross limits, following the exact-request contract. The selected cross size
is never fed back into percentage references. These are bounded measurement
phases, with no aspect-fitting search or font scaling. Fill follows the same
phases but preserves explicit cross dimensions and child alignment overrides, and clamps
automatic allocations to child limits. Only participating fill/stretch children
are remeasured at their selected cross size. A stretching column keeps its selected
width if a non-stretching child later grows wider during height allocation;
that excess is overflow, not another width-selection/reflow cycle.

Baseline alignment uses each participating child's first `baseline` guide, falling
back to its bottom edge. The row includes the group's largest extents above and
below that guide, as well as other children's heights. A child can opt into or out
of this group with `align_self`; baseline alignment is only available in horizontal
stacks. Stretching siblings receive a height that includes the baseline group.
Stacks propagate the first guided child's guides and the last textual child's
`last_baseline`, shifted into the stack's coordinates. `justify` only positions
completed main-axis slots; `align`/`align_self` position their cross axes; `Text.justify`
positions text inside its own allocation. Center/end can use negative offsets
for overflowing content. Distributed spacing only adds positive free space to gaps.

`Spacer` is an empty element whose source defaults are `{ basis: 0, grow: 1 }`.
It needs no parent type check, has no ink, and is zero-sized naturally. Override
its basis, weights, or bounds like any other stack child. For a fixed spacer, use
`<Spacer basis={px(20)} grow={0}/>`; its default zero basis takes precedence over
a preferred main-axis dimension.

The pure [flex allocator](./src/lib/flex.ts) accepts resolved pixel bases and bounds and
returns immutable sizes. The [stack implementation](./src/elems/stack.ts) owns child queries,
text reflow, guides, and placement. LayoutPass remains independent of both policies.

### Wrapping rows

`HStack wrap` and `TextRow wrap` form rows when another item would exceed the
available width. Set `basis` or `min_width` on growing items to choose useful
breakpoints. `gap` separates items; `line_gap` defaults to `gap`. Each row applies
ordinary flex and alignment. A natural-width request produces a single row.

## Grids

`Grid` places children row by row with shared column widths and content-sized rows.
`TextGrid` uses the same layout, converts strings/numbers to Text at construction,
and defaults to an `em(0.6)` gap. Both are exported and available in JSX.

```jsx
<Grid columns={2} width={em(24)} gap={em(1)} align="fill">
  <TextFrame>First panel</TextFrame>
  <TextFrame>A longer panel that wraps within its column.</TextFrame>
  <TextFrame>Third panel</TextFrame>
</Grid>
```

| Grid prop | Meaning |
|---|---|
| `columns` | Positive count (default `1`) for equal columns, or a nonempty array of `Length` / `"auto"` tracks. Maximum 100000 columns. |
| `gap` | Row and column spacing, default `0` on Grid, `em(0.6)` on TextGrid. |
| `column_gap`, `row_gap` | Override spacing on one axis. |
| `align` | Two-axis cell alignment, default `{ x: "fill", y: "start" }`. Children can override it with `align_self`. |

Equal columns divide a finite width offer after subtracting column gaps. With no
offer, each column uses the widest natural cell, enlarged by an own minimum width
if needed. An incomplete final row retains the full column structure. An empty
Grid hugs zero unless its own sizing reserves space.

An explicit track array, such as `[em(6), "auto", em(12)]`, determines both count
and widths. Auto columns use their widest natural cell. These tracks do not flex
to consume an offer, and their combined width sets the natural Grid width.
Numeric tracks are fractional lengths of the selected width after column gaps;
`[0.25, 0.75]` tiles it in those proportions. They require a finite width or offer.
Column gaps reference that width before gaps; fractional row gaps require an
established Grid height. Absolute/em gaps work on natural axes.

Cells are measured at the selected widths before row heights are chosen. The
column width is the child's percentage reference; the row height stays indefinite
throughout measurement, so percentage cell heights and vertical padding report an
unresolved dependency. A natural column also cannot be sized by a percentage of
itself. Cell `height="fill"` or vertical fill/stretch can occupy the selected row
height, keeping the measured width fixed. Fill respects explicit sizes and limits;
stretch overrides them. Rows never distribute spare Grid height. Tracks remain
fixed if finishing the Grid's own aspect or limits changes its frame.

Null/boolean children and blank JSX whitespace are skipped; nested arrays flatten.
Use `<Box />` for an empty cell. Overflow is retained. There are no spans, baseline
groups, automatic column counts, flex track weights, or inferred overall aspect.
Child `basis`/`grow`/`shrink` are not Grid track settings.

See the [Grid reference](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Grid.md)
and [grid tests](./test/grid.ts) for the sizing contract.

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
    <Text x={0.5} y={0.5} anchor={{ y: 'center' }} width={0.4}>
      A label in its own region.
    </Text>
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
`anchor={['end', 0.5]}`. Per-axis Box/Anchor alignment, fitting alignment, and Rotate origins also
accept tuples. Stack alignment stays a single-axis value.
Anchors accept neither fill nor stretch; width and height control sizing.

Position metadata belongs to the direct child. Put it on the Box or VStack when
that container is what Group should place. Nested Groups create local canvas
references: a half-width child of a half-width Group occupies a quarter of the
outer width. Source order is paint order. Group has no implicit baseline from its
arbitrarily placed labels; child fragments retain their local guides.

Group uses one query per child, then positions completed fragments. Pixel-sized
fonts and strokes remain pixel-sized when the canvas changes; text reflows within
its region. Set `fit` on a positioned element to scale its completed drawing.
Clipping affects visible ink and leaves allocations and unclipped overflow inspectable.

See the [Group implementation](./src/elems/group.ts) and the
[canvas](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Group.md),
[anchors](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/text/group_anchors.md), and
[clipping](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/text/group_clip.md) examples. Horizontal stacks support `wrap` and `line_gap`;
Grid supplies shared columns across rows.

## Text and fonts

```jsx
<Svg width={px(360)} height={px(200)} font-size={px(18)} color="#203746">
  <Text width={px(320)} line-height={em(1.4)}>
    A paragraph with <Span font-weight={bold}>bold words</Span> and <Span font-style="italic">italic words.</Span>
  </Text>
</Svg>
```

`Text` accepts strings, numbers, nested arrays, conditional children, and inline
`Span` elements, formulas, and other elements. Use string expression children to preserve exact whitespace. Spans inherit
font family, weight, style, size, line height, and `color`; they introduce no boxes
or word breaks. A standalone `Span` can also be measured as text. Inline elements
are indivisible, align by baseline (or their bottom edge), and enlarge the line
using their logical height and depth. Give figures concrete dimensions; an
oversized item overflows rather than shrinking. Inline spans have style props,
not sizing or independent layout props. Mixed prose and elements also work in
text boxes, bullet items, captions, and titles.

Text defaults to IBM Plex Sans, weight 400, 16px, 1.2em line height, and black.
`color` paints glyphs; `fill`/`stroke` paint shapes. Relative font sizes refer to the
inherited size; relative line height refers to each run's newly resolved size.
An inherited `line-height={px(20)}` remains 20px even in a larger span.

| Text property | Behavior |
|---|---|
| `wrap` | Defaults to true; wrap at supported Unicode line-break opportunities. |
| `whitespace="normal"` | Collapse horizontal spaces/tabs and trim hard-line edges; **retain explicit newlines**. |
| `whitespace="pre"` | Preserve spaces and expand tabs at `tab_size` column stops (default 4). Wrapping remains independently controlled by `wrap`. |
| `justify` | `start` (default), `center`, `end`, or a fraction from 0 to 1, inside the final allocated width. |
| `font_family` | `IBM Plex Sans`, `IBM Plex Mono`, or a registered family. |
| `font_weight` | Numeric 1–1000 or `"light"` (300), `"regular"`/`"normal"` (400), `"bold"` (700); choose the nearest available weight, lower on ties. |
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
[JSX reference](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/jsx.md#jsx-whitespace) for more examples.

Automatic hyphenation, emergency word splitting, and full paragraph bidi are
not currently supported. Unknown families and missing glyphs produce errors
instead of silent substitution; only a face registered with `fallback: true`
receives the grapheme clusters that the requested face lacks. The one bundled
fallback measures emoji.

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

Each pass supplies its own lazy `fonts` resource. Bun loads bundled files on
first use; importing the module does no file I/O. Other hosts can preload with
`await fonts.load()`, register font bytes, or provide a different measurement
implementation. Browser hosts must serve the bundled TTF assets and preload
fonts before layout. Outlined text needs no fonts in the resulting SVG viewer;
color-font glyphs remain live text, as described below.

```ts
import { Fonts, LayoutPass } from '@gum-jsx/core'

const fonts = new Fonts()
fonts.register('My Font', font_bytes, { weight: 400, style: 'normal' })
const pass = new LayoutPass({ fonts: { value: fonts, version: fonts.version } })

// After later registrations, explicitly invalidate any reused pass:
pass.set_resource('fonts', fonts, fonts.version)
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

**Color fonts are the exception.** A face with a `CBDT`, `sbix`, `COLR`, or `SVG `
table has no outline that one fill can paint, so emoji stay live text. This works
with no setup: `<Text>Ship it 🚀</Text>` outlines its Plex words and emits the
rocket as `<text font-family="'Noto Color Emoji'">`.

A color face only measures. Each grapheme cluster, including joined, flag, keycap,
and skin tone sequences, takes the advance of its base glyph from `cmap` and
`hmtx`, and its ink is that advance by the font's ascent and descent. `Fonts`
therefore bundles `NotoColorEmoji-Metrics.ttf` as its default fallback: 8 KB that
hold the coverage and advances of Noto Color Emoji, and no glyph data. Regenerate
it with `bun scripts/emoji-metrics.ts` after updating `@fontsource/noto-color-emoji`.

The host that displays the SVG paints the emoji, so it should supply the family
exported as `EMOJI_FAMILY`, for example as a web font. Each cluster is a separate
`text` drawing centered in its advance, so a substituted host font, such as a
system emoji font, cannot drift along the line. To measure with another emoji font,
register its bytes; the same family name replaces the bundled face:

```ts
fonts.register('My Emoji', emoji_bytes, { fallback: true })
```

Without the `fallback` flag a family is still usable through `font_family`. The
PDF back end reports live text as an error, since it embeds no font data.

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
| `Rect` | `border_radius` defaults to zero; a scalar uses the shorter side, `{x,y}` / `[x,y]` resolves per axis, and a side/corner object selects corners as on Box. |
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
[point values reference](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/point_values.md) and its runnable example.

```jsx
<Path width={px(120)} height={px(60)} stroke-width={px(2)}
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

Shape defaults are `fill="none"`, `stroke="black"`, and `stroke-width={px(1)}`.
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
| Scalars, reductions, interpolation | [Math helpers](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/math_helpers.md): sin/cos, log/exp, sum/mean, norm, clamp, rescale, sigmoid, rounder |
| Sequences and arrays | [Arrays](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/arrays.md): range, linspace, zip, enumerate, repeat, meshgrid, lingrid, reshape, split, concat, slice |
| Vector and complex arithmetic | [Vectors](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/vectors.md): polar/polard, add2/sub2/mul2/div2, N-dimensional equivalents, addc/subc/mulc/divc, conjc/normc/argc |
| Color interpolation | [Colors](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/colors.md): interp, palette |
| Reproducible samples | [Random](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/random.md): setSeed, random, uniform, normal, integer, RNG |

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
[migration notes](https://github.com/CompendiumLabs/gum-jsx/blob/master/docs/MIGRATION.md#numeric-helpers) for
differences from the original helpers.

## Graphs and plotting

```jsx
<Svg width={px(640)} height={px(400)}>
  <Plot title="A sampled curve" xlabel="x" ylabel="sin(x)"
    xlim={[0, tau]} ylim={[-1.2, 1.2]} background="white">
    <SymLine fy={sin} xlim={[0, tau]}
      stroke={blue} stroke-width={px(2)} />
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
| Plot composition | [Plot](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Plot.md), Graph, Legend, OuterLabel |
| Axes and grid | Axis/HAxis/VAxis, Scale, Label/Labels, Mesh/Mesh2D and directional variants |
| Bars | Bar/VBar/HBar, Bars/VBars/HBars, BarPlot |
| Sampling | [SymLine](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/SymLine.md), SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField |
| Composition | Overlay, Anchor, Attach, Rotate, TransformBox |
| Text and slides | TextStack/Row/Col, TextGrid, TextBox/Frame, TextFigure, Bullets, TitleBox/Frame, Slide |

`Attach` uses `at` to select a point along the content edge and `child_anchor`
to select the attachment's own point along that edge; both default to 0.5. The
wrapper's own `anchor` remains independent. Use `child-anchor` in JSX or
`child_anchor` in host props; this replaces the earlier `Attach.align` name.

Arrow shafts retreat at headed ends to hide the cap behind the triangular tip.
Clearance uses the resolved shaft stroke, cap style, and head width after data
mapping. Original head tips, unheaded endpoints, and inferred limits stay fixed.
Short terminal segments are consumed without reversing the shaft; if the whole
route is consumed, only the heads remain. Field arrows share the same rule.
See the [cap comparison](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/code/arrow_caps.jsx) for thick straight, curved, and
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
and [coordinate helpers](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/coordinates.md) can also be
used directly. `static normalize(input)` consumes raw input once before source
defaults are merged; `Element<SourceProps, InputProps>` types the two separately.
The same hook is available through define_element's fourth options argument.
define_component adopts another element's source
description without a layout wrapper. Neither stores callbacks in source data.

This is a basic linear plotting API. Log/date scales, label collision avoidance,
adaptive sampling, grouped/stacked bar automation, and advanced arrowheads
remain deferred. Splines can overshoot samples; a
sampler cannot identify discontinuities between two finite samples. See the
[overview](https://github.com/CompendiumLabs/gum-jsx/blob/master/docs/PLOTTING.md) and [docs](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/README.md) for decisions,
examples, and current limits.

## Networks

```jsx
<Svg width={px(480)} height={px(200)}>
  <Network>
    <Edge start="input" end="output" stroke={blue} />
    <Node id="input" x={0} y={0}>
      Input
    </Node>
    <Node id="output" x={1} y={0}>
      Output
    </Node>
  </Network>
</Svg>
```

Any element with an `id` is a node. Node is the conventional one: a compact
TextFrame with a centered placement anchor. Network uses Graph sizing and coordinates, inferring limits
from child x/y positions and edge waypoints with 0.2 default data padding. Explicit node
widths wrap labels at their ordinary font size. Put edges first to paint them
behind nodes; source order remains paint order independently of measurement order.
`align` positions the label inside Node. `text_*` props pass to the generated
`Text` label without their prefix: `text_justify` sets line alignment and
`text_font_size` sets its `font_size`, for example. An explicit
`Text` child uses its own properties.
Supply label text as children, for example `<Node text-justify="center">Label</Node>`.

Each identified element's fragment exposes `connection: { id, boundary }` in local
pixels. Boxes, rectangles, squares, circles, and ellipses report their rounded or
elliptical outline; LayoutPass supplies the allocation rectangle for the rest. Network lays out ordinary children
first, then follows their placements to locate these boundaries through Box,
Rotate, and other containers, including fitted elements. Ports and normals follow the composed transforms,
including when the visible frame differs from its surrounding allocation.
Identified containers stay transparent, so a group and its members are both
addressable. Nested networks set `connection_scope` to keep their IDs local, and
an ID on the nested network makes it one node of the outer one. Custom elements
can refine their boundary with `frame_connection(props.id, boundary)`.

Edges are direct Network children. `start`/`end` accept IDs or elements with
IDs; references do not insert nodes into the diagram. Automatic sides face the
other node or adjacent waypoint. `start_side`/`end_side` and `start_loc`/`end_loc`
override the ports in each node's local frame. Rounded corners use the actual
outline. Edges share Arrow's heads and styling, with curved routes by default,
straight routes via `curve={false}`, rounded routes via `radius`, and optional
`gap` clearance. Equal endpoint IDs produce a self loop. Duplicate or missing IDs
fail during layout. Node placement and obstacle avoidance remain explicit.

See [Network](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Network.md),
[Edge](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Edge.md), and the
[transformed connection example](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/gallery/code/network_connections.jsx).

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
| Node, TextBox, TextFrame | `text_` | Generated label TextOptions, including `text_justify` |
| TitleBox, Slide | `title_` | Generated title TextOptions |
| TitleFrame | `title_` | Title text and box styling; `title_position` defaults to centered across the top border |
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
prop names and value types. See [Custom elements](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/custom_elements.md).

Scopes are constructor-input syntax. `static defaults` still contains canonical
source props and merges after normalization; for example Arrow defaults use
`head_style`, not `head_fill`. Defaults that affect generated children belong in
a component or normalizer, before those children are constructed.

## Rendering and inspection

`render_svg(fragment, { title?, background?, id_prefix?, precision? })` consumes only fragments.
Numeric output uses 10 decimal places by default. Set `precision` to an integer
from 0 to 100, or to `'full'` for JavaScript's unrounded number strings. Formatting
omits trailing zeroes and changes only serialized output, not layout or fragment geometry.
For example, `precision: 3` formats `123.45678` as `123.457`; `precision: 0` rounds to whole numbers.
It emits escaped SVG, resolved drawing geometry, explicit placement transforms,
and rectangular clip definitions. Identity placements and attribute-free fragment
groups are omitted; transforms, clipping, and accessible labels retain their groups.
The fragment tree remains intact for layout and inspection. Rendering performs no
layout or font work. Definition
IDs are allocated per render and reused for repeated placements of a shared clip;
speculative layout queries cannot consume IDs. Supply distinct `id_prefix` values
when embedding several generated documents inline in one page.

`render_element(value, options)` is the host entry point above these stages. A
bare element is wrapped in `Svg`; an existing `Svg` keeps its layout descriptor
and props, with `options.defaults` spread beneath them and `options.overrides`
above them, while `options.wrap` props reach only a generated viewport, such as
preview bounds an explicit `Svg` should not inherit (undefined entries are
ignored throughout). For example, `wrap: { max_width: px(640), max_height: px(480) }`
reflows a bare element within those offers and scales down the whole figure if
needed to satisfy the maxima. The viewport is laid out under
`options.request` by `options.pass`, or by a new pass seeded with `options.fonts`
or the core fonts, and serialized with the remaining `render_svg` options. Fonts
given alongside a pass are installed on it through `set_resource`. The result is
tagged: `{ kind: 'svg', svg, size, fragment, pass }` for an element, or
`{ kind: 'value', value }` for any other evaluated result, which hosts print
instead. `layout_element` stops at the fragment and `make_viewport` performs only
the wrapping. Both `render_element` and `layout_element` return the narrower
element result when the argument is statically an `Element`.

`inspect_fragment(fragment)` prints local sizes, content rectangles, offsets,
matrices, ink, overflow, and guides. The CLI's `tree` format uses it; `json` exposes
the complete result.
The renderer uses the fragment's allocated size directly as both SVG dimensions
and viewBox extent. Ordinary resizing relays a new request through the layout pass;
only an explicit placement matrix scales completed geometry and strokes.

## Contributor notes

Install dependencies from the parent Bun workspace with `bun install`. Run this
package's `bun run test` and `bun run typecheck` when changing runtime behavior.
JSX examples are read as source by `evaluate`; they need no React JSX runtime.

Source modules are grouped by responsibility: `src/elems/` contains concrete
Elements and element compositions, while `src/lib/` contains reusable helpers
for math, sampling, layout composition, props, and JSX parsing. `src/engine/`
contains the shared Element and layout contracts, layout pass, geometry, units,
styles, drawing data, and font adapter. The source root exposes the public API (`index.ts`), JSX evaluation (`eval.ts`),
host rendering helpers (`render.ts`), SVG rendering (`svg.ts`), and fragment
inspection (`inspect.ts`). Package consumers should import from `@gum-jsx/core`.

| Responsibility | Start here |
|---|---|
| Length syntax, reference resolution, and defaults | [units.ts](./src/engine/units.ts), [defaults.ts](./src/engine/defaults.ts), [style.ts](./src/engine/style.ts) |
| Requests, shared sizing, and geometry | [layout.ts](./src/engine/layout.ts), [geometry.ts](./src/engine/geometry.ts), [composition.ts](./src/lib/composition.ts) |
| Immutable descriptions and element factory | [element.ts](./src/engine/element.ts) |
| Queries, caches, resources, and diagnostics | [pass.ts](./src/engine/pass.ts) |
| Box, root Svg, and explicit fitting | [box.ts](./src/elems/box.ts), [Svg](./src/elems/svg.ts) |
| Stack queries versus pure flex allocation | [stack.ts](./src/elems/stack.ts), [flex.ts](./src/lib/flex.ts) |
| Shared grid columns and content-sized rows | [grid.ts](./src/elems/grid.ts), [grid tests](./test/grid.ts) |
| Positioned canvas and direct-child metadata | [group.ts](./src/elems/group.ts) |
| Text preparation/reflow and font adapter | [text.ts](./src/elems/text.ts), [fonts.ts](./src/engine/fonts.ts) |
| Shapes, path commands, drawing, and immutable results | [shapes.ts](./src/elems/shapes.ts), [path.ts](./src/engine/path.ts), [drawing.ts](./src/engine/drawing.ts), [fragment.ts](./src/engine/fragment.ts) |
| Public API and JSX names | [index.ts](./src/index.ts), [eval.ts](./src/eval.ts) |
| Rendering and debugging | [svg.ts](./src/svg.ts), [inspect.ts](./src/inspect.ts) |
| Command-line I/O | [gum-jsx-cli](https://github.com/CompendiumLabs/gum-jsx-cli/blob/master/README.md) |
| PNG conversion | [gum-jsx-png](https://github.com/CompendiumLabs/gum-jsx-png/blob/master/README.md) |

“Keep the layout pass ice cold.” Add container behavior to the container or a pure
helper. Shared ElementProps includes flex and position metadata for typing; their
presence does not make them engine policies. Extend `Element` for new primitives,
keep source data immutable, and place the returned fragments. Opaque objects and
font providers belong in pass resources. No measuring in constructors, rebuilding
children during queries, implicit margin wrappers, or layout inside the serializer.

Keep `query.request`, `query.measure.reference`, and `query.style` distinct. Pass child
references explicitly; omitted references are indefinite. Exact allocations override
preferred dimensions and min/max, but source sizing still has to resolve first.
Do not round widths to improve cache hits: text break boundaries are observable.
`query.prepare()` may depend on source, resolved style, and resources, never the
current request, reference box, coordinate context, or path. Resource revisions
invalidate the pass's layout and preparation caches. Reuse source identities to reuse fragments; equal
props on two newly constructed elements do not give them a shared cache entry.

When adding a public element, export it and its types in `src/index.ts`, add its JSX
binding in `src/eval.ts`, and wire relevant checks into `test/run.ts`. Add concise
paired Markdown/JSX examples to `gum-jsx-docs` and run its test command;
inspect CLI-generated images and numerical trees. The custom placement examples
are intentional protocol examples, while new composition examples should use the
standard elements. Update this reference, the relevant docs pages, and roadmap status.

For runtime changes, run `bun run test` and `bun run typecheck` here. The core suite
covers contracts and layout. The workspace's `bun run test` runs this core suite.
The suite also covers plotting, sampling, numeric helpers, mixed point inputs,
and composition behavior.
For public type changes, also verify
declaration emission into a scratch directory:

```sh
bun tsc --noEmit false --declaration --emitDeclarationOnly --outDir /tmp/gum-jsx-types
```

The docs examples render through the workspace CLI and gum-jsx-edit's docs view.
Use `pass.stats` and counting font providers for
measurement-cost regressions. Natural hugging and Group examples generally query
each child once; flex/reflow/stretch may require additional queries. Counted layouts,
cache hits, and prepared glyph reuse are distinct. Preserve the opposing-clamp and
text-width-boundary cases when changing allocation. See the
[roadmap style guide](https://github.com/CompendiumLabs/gum-jsx/blob/master/docs/ROADMAP.md#style-guide) for the project's implementation style.
