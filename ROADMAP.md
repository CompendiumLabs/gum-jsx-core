# Fresh core implementation roadmap

The new core uses immutable element descriptions, explicit layout requests, and
immutable layout results. The scoped roadmap covers SVG elements, ordinary shapes,
text, boxes, stacks, positioned groups, wrapping rows, and a simple grid. Math,
plotting, networks, slides, and migration of the add-on packages come afterward.

Stages 1–5 are implemented in this directory, with
unit and layout checks, JSX evaluation, measured and wrapping text, ordinary shapes,
Box/Frame/Fit composition, HStack/VStack/Spacer, a local rendering CLI, and an SVG/PNG/tree
[gallery](./examples/README.md). Stage 6(a), positioned Group, is
also implemented. Stage 6(b), wrapping stacks, is next.
Content-sized SVG dimensions moved forward into stage 4: a Box can hug a Square,
and Svg can hug the whole result, with one layout query per element. A fixed-width
SVG can also derive its height from a framed, wrapping paragraph.
The agreed decisions and original legacy assessment are preserved in [DESIGN.md](./DESIGN.md).
This file tracks scope and status; [README.md](./README.md) covers usage, implementation
ownership, and contributor commands. The checkpoint is complete through 6(a); remaining
stages below are future work, not part of the current API.

**The agreed direction is a Flutter/SwiftUI synthesis.** Parents control allocation and
position; children answer layout requests with geometry. A parent may make more than one
query, but queries do not reconstruct element definitions. Text style is resolved before
measurement. Intrinsic information is useful input to allocation, rather than a promise
that arbitrary layout behavior can be represented by two ranges and an affine aspect.

**The agreed unit rule applies to lengths.** A raw number is a fraction. `em(n)` and `px(n)`
construct immutable value/unit objects. All resolved layout geometry uses pixels.
Dimensionless values such as opacity, aspect ratio, and flex weights remain ordinary
numbers. There is no `unit_size` or separate stroke-unit system in the new core.

```ts
type Length = number | Readonly<{ value: number; unit: 'em' | 'px' }>

// A single boundary normalizes all three forms:
type NormalizedLength = Readonly<{
  value: number
  unit: 'fraction' | 'em' | 'px'
}>
```

Unit strings can be added later as another input syntax. They are not needed for the first
implementation. Property values remain tagged until the required reference is available;
parsing a fraction must not prematurely turn it into pixels.

**The following conventions are implemented and covered by examples and tests.**
Preserve them when adding the remaining containers:

| Question | Implemented rule |
|---|---|
| What is a pixel? | One SVG/CSS layout pixel at the document's normal display size. Raster pixel ratio changes sampling resolution, not layout. Changing viewport dimensions runs layout again. |
| What establishes the root size? | Explicit viewport dimensions use `px()`. Omitted axes hug the child's measured allocation, including any surrounding Boxes. This supports both natural sizing and content-sized height under a fixed width, without magnifying the result. |
| What does `em()` reference? | The element's resolved font size. While resolving `font_size` itself, `em()` references the inherited font size. A fraction used as `font_size` likewise references the inherited font size. |
| What does fractional width or height reference? | The corresponding axis of the parent's established content box, before allocating individual flex slots. A temporary measurement proposal does not change that basis. |
| What does fractional padding reference? | The corresponding axis of the containing content box: horizontal sides use its width; vertical sides use its height. These are outside references, not the box's own unresolved dimensions. |
| What does a fractional gap reference? | The stack's established content length along its main axis. A gap remains distinct from a flex weight. |
| What if that reference is indefinite? | `measure_length` can retain a tagged dependency, but LayoutPass resolves source sizing before calling an element, even on a natural request. A nonzero fraction without its basis reports a property-path error. Zero needs no basis. General percentage-cycle solving is deferred. |
| What do fractional shape coordinates reference? | The shape's own resolved content rectangle. Scalar geometric lengths such as a circle radius, stroke width, or circular corner radius use its shorter side; two-axis radii resolve per axis. Arbitrary data-coordinate systems are deferred with plotting. |
| What do `Box.width` and `height` include? | The border box: content, padding, and border. Borders occupy space and draw inside the border box. For space outside the decoration, wrap the Box in another Box with padding. |
| Does making a box smaller scale its contents? | Ordinary layout reflows, constrains, or records overflow. An explicit `Fit` operation may scale a completed fragment, including its text and strokes. |
| Who reads flex and position props? | The immediate stack reads `basis`/`grow`/`shrink`; the immediate Group reads `x`/`y`/`anchor`. They do not inherit or acquire behavior in LayoutPass. |
| Does every empty container hug to zero? | Empty Box/Svg/stacks follow ordinary zero-content sizing. Group requires a finite canvas even when empty; its children never determine the viewport. |

A finite available-space offer is not automatically a definite percentage reference. A
container that still hugs an axis cannot use its as-yet-unknown result as that axis's basis.
The initial rule deliberately makes such dependencies visible: use absolute lengths on
that axis or establish its size. This keeps the first engine free of implicit fixed-point
iteration. The reference basis travels separately from the trial allocation in a query.
Group and Fit explicitly commit to selected finite axes from offers before querying
children, so those axes can become references. That is an element policy, not a
reason to promote every available offer to a reference inside LayoutPass.

**The execution model has three distinct objects.** An element stores the source
description; a layout pass owns resolved style, font resources, caches, and diagnostics;
a fragment stores the result for one request. The same element can appear twice, receive
different inherited styles or allocations, and produce independent fragments.

```ts
// The implemented entry points; source, request, and context are caller inputs.
const element = evaluate(source);
const pass = new LayoutPass();
const fragment = pass.layout(element, request, context);
const svg = render_svg(fragment);
```

There is no separate `intrinsics()` API. `make_request()` uses natural axes by
default; a container asks the same layout method for natural or constrained
geometry. `define_element(name, layout, defaults?)` keeps construction independent
of these queries. See the actual contracts in [element.ts](./src/element.ts),
[pass.ts](./src/pass.ts), and [fragment.ts](./src/fragment.ts).

Each axis request distinguishes `natural`, `available(value)`, and `exact(value)`.
Available space is a budget: a child can report needing more. An exact request fixes the
allocated box; content that cannot fit is represented as overflow. An exact parent
allocation takes precedence over a child's preferred size. Common sizing code handles
explicit dimensions and min/max limits consistently across elements.

Fragments contain a finite size, optional baseline/alignment guides, ink bounds, overflow
information, drawing data, and children with local offsets or explicit transforms. They do
not contain mutated copies of source elements. Layout bounds, painted ink, and overflow
remain distinct, including after clipping. Alignment guides begin with text baselines; a
future math implementation can add an axis without changing the layout protocol.

Intrinsic queries are parameterized by relevant known dimensions and resolved style.
They share the sizing implementation with normal layout. The framework does not require
every custom element to supply exact symbolic bounds or create a second independent
measurement algorithm. Optional analytic shortcuts must agree with the actual response.

The following milestones are successive runnable slices, not a long infrastructure phase
followed by element implementation.

| Milestone | Status | Deliverable / completion reference |
|---|---|---|
| 1. Contracts and units | Complete | Lengths, references, sizing precedence, and fragments; [contract probes](./examples/contracts.ts) distinguish indefinite axes from zero. |
| 2. Elements and SVG | Complete | Immutable descriptions, queries, JSX, SVG, and CLI; [repeated.jsx](./examples/repeated.jsx) reuses descriptions and fragments at different placements and sizes. |
| 3. Text and shapes | Complete | Font measurement, wrapping, styled runs, baselines, glyph paths, and ordinary shapes; [paragraph.jsx](./examples/paragraph.jsx) and [shapes.jsx](./examples/shapes.jsx). |
| 4. Box composition | Complete | Box/Frame/Fit and content-sized Svg; [hugging.jsx](./examples/hugging.jsx) and [card.jsx](./examples/card.jsx). |
| 5. Stacks | Complete | HStack/VStack/Spacer, gaps, basis/grow/shrink, min/max, alignment, baselines, and overflow; [stack.jsx](./examples/stack.jsx) nests mixed rows at two widths. |
| 6(a). Positioned Group | Complete | A finite canvas with fractional/px/em positions, anchors, nested references, and clipping; [group.jsx](./examples/group.jsx). |
| 6(b). Wrapping stacks | Next, unimplemented | Wrap measured items into lines, then allocate and align each line with stable references and explicit overflow. |
| 6. Remaining composition | Pending | Content-sized overlays, a simple grid, and an optional common-height figure policy; separate slices after wrapping. |
| 7. Stabilize the new core | Pending | Consolidate API documentation, diagnostics, numerical contracts, SVG/browser inspection, and measured layout costs. |

**Milestone 1 established the contracts and defaults.** [defaults.ts](./src/defaults.ts)
contains the 16px font and natural shape fallback, 1.2em line height, and 1px stroke.
The probes cover a fixed viewport, hugging content, a half-width child, tight aspect
allocations, and insufficient space for padding. Zero-size content remains distinct
from an indefinite reference; Group's later finite-canvas requirement is explicit.

Normalize length values centrally. Fractional allocation, growth weights, and scaling are
different concepts and receive different types or properties. Internal layout calls use
resolved pixel geometry; no element performs ad hoc em-to-parent or stroke-unit conversions.
Named inset fields avoid an overloaded tuple format that can mean either sides or mixed
units. Sizing inputs must distinguish an unknown dimension from a known zero dimension.

**Milestone 2 established the rendering path.** JSX and component evaluation
produce descriptions without measuring children. Layout resolves inherited style before
asking intrinsic questions, returns fragments, and caches by element identity, resolved
style, request, reference box, and relevant resource versions. Parents store child offsets
on their own result. Placing a completed fragment does not measure it again. Reusing
the same source element with identical query inputs hits the cache; constructing a
new description creates a new identity even when its props have equal values.

The SVG renderer consumes fragments, emits resolved geometry, and handles escaping,
definitions, and explicit transforms. It never performs layout or changes font metrics.
Clip identifiers and other drawing identifiers are assigned outside speculative queries.
The local render command and textual fragment inspector make every later stage
inspectable. Synthetic fixed, expanding, and width-dependent leaves still exercise
the protocol independently of fonts; they are fixtures, not built-in public elements.

**Milestone 3 made text a foundation of the containers.** Text implements plain and
styled runs (`Span`), inherited font family/weight/style/size, explicit newlines, word
wrapping, whitespace handling, and line alignment. The Fontkit adapter reuses bundled
font assets, without old text elements or their reconstruction protocol. SVG uses glyph
paths and accessible labels; selectable native text is deferred.

Resolve font size once before measuring runs. Derive baselines and ink bounds from font
metrics, with a separately controlled line height and leading. A glyph extending beyond
the line box does not silently shrink its font. Separate prepared text from width-dependent
line layout so changing the width reuses font and run measurements. Cache exact requests
without rounding across line-break boundaries. Keep the font measurement contract
replaceable; advanced shaping and bidirectional text are not prerequisites for this first
core, whose initial text coverage uses the bundled faces and supported line breaking.

Rect, RoundedRect, Square, Circle/Ellipse, Line/Polyline, Polygon, and Path are
implemented alongside text, with finite natural-size fallbacks, preferred aspects,
fills, strokes, and conservative ink bounds. Degenerate lines and empty shapes remain finite.
Shapes without a preferred aspect fill offered axes independently; unoffered axes use
the finite natural fallback. Square and Circle supply a preferred 1:1 aspect. Rect and
Ellipse accept both dimensions of a rectangular viewport without explicit sizing props.
Resizing a shape's ordinary layout box changes its geometry without implicitly increasing
its pixel stroke width. Fitting a complete drawing is an explicit transform.

**Milestone 4 built Box from shared operations.** Deflation/inflation, common size
selection, positioning, border/background geometry, and clipping are implemented;
Fit handles uniform scaling. Box has one layout content child. Use a stack for flow
or Group for a positioned canvas; a content-sized overlay is still future work.
Rectangular and rounded frames are supported. Decoration does not determine content size.

Keep the rules for allocated box, border box, content box, and ink visible in the result.
Border geometry uses the same resolved thickness used by layout. An empty box is the size
of its insets and border, subject to its sizing request. Oversized insets cannot create
negative child dimensions. Frame supplies a default 1px border. Text belongs in ordinary
`Text`, so `TextBox` and separate text-layout hierarchies are unnecessary for the first API.

Stage 4 implements Box and Svg with a shared deflate/query/inflate/align operation.
Spacing inside and outside decoration uses explicit nested Boxes. The layout pass
handles shared style, sizing, queries, validation, and caching; composition belongs
to elements. There is no shared margin prop or automatic wrapper. Each Box owns its
border box and establishes its own child references. Clip and border fragments are
plain results, not reconstructed elements. Fit measures naturally and applies one uniform transform.
The completion gallery includes fully hugging and nested boxes, inside rounded borders,
clipped overflow, and one paragraph at two widths. Content-sized root axes are included
here; unresolved percentage dependencies remain explicit errors.

**Milestone 5 implemented ordinary stack allocation before special fitting policies.**
HStack and VStack use one main-axis/cross-axis implementation with intrinsic packing,
explicit sizes, fractional sizes, gaps, and basis/grow/shrink policies. Growth is explicit
metadata, not inferred from an infinite maximum. The allocator determines bases and
gaps, then distributes the remaining space with min/max clamps.
Insufficient space follows the documented shrink/overflow policy.

Lay text out for the selected width; determine the cross size from the results; align and
stretch through explicit requests. Preserve the distinction between text alignment,
main-axis packing, and cross-axis alignment. Baseline alignment uses actual baseline
guides. A `Spacer` is a zero-basis growing item. Fractional gaps require a definite main-axis
basis; equal flex weights divide the space left after those gaps. Temporary child probes
never change the parent-relative basis of a fractional width.

Stage 5 implements both stack directions through one allocation/placement method
and a pure flex allocator. Direct children carry basis/grow/shrink metadata; both
weights default to zero, so growth and shrinkage are explicit. Spacer supplies a
zero basis and growth weight one in its source description. Flex limits redistribute
space without losing opposing clamp corrections, and impossible budgets retain
overflow. Padding and clipping remain Box composition; LayoutPass has no stack policy.

Rows allocate widths before measuring the resulting height. Stretching columns
select a shared width before allocating heights, so text reflows at that width.
Cross alignment, baseline alignment, and main packing operate on completed fragments;
prepared text is reused. Percentage references remain fixed throughout these phases.
The gallery includes the mixed row nested in columns at two widths, completely natural
stack composition, flex limits and shrinkage, baselines, distributed packing, and stretch.

**Milestone 6 is partially complete.** Positioned Group is implemented as 6(a).
Wrapping stacks are next in 6(b); overlays, grid tracks, and the optional common-height
figure policy remain separate work. Keep reflow into a region distinct from fitting
an already laid-out drawing into it.

Stage 6(a) implements Group as a positioned canvas. Dimensions and finite offers
establish its rectangle before any child query; a preferred aspect can derive one
axis. Unresolved canvas axes are explicit errors, including for empty groups.
Children use ordinary width/height sizing plus x/y/anchor metadata read only by
their immediate Group parent. Fractional positions and extents refer to the full
canvas; em positions use the child's local font. Anchors position completed child
allocations, and nested groups establish independent local references. Paint order
follows source order, and optional canvas clipping preserves overflow. The gallery
covers resized drawings, nested anchor demonstrations, and shared clipped artwork.
Content-sized overlays remain separate work; the next slice is 6(b), wrapping stacks.

For **6(b), wrapping stacks**, first specify how the container chooses a line width,
forms lines, and treats an item wider than a line. Decide when that width becomes a
percentage reference and keep it stable during probes and per-line allocation. Reuse
the pure flex allocator where its contract applies; line formation remains container
policy. Cover gaps at line boundaries, per-line growth/shrinkage, text reflow after
width allocation, baseline/cross alignment, and explicit overflow. A completion example
should wrap the same set of mixed cards at two widths without rebuilding descriptions.

Remaining composition slices are:

- A content-sized overlay with one explicit sizing child and non-sizing decorations.
  Group already provides layering on a finite canvas; it is not that hugging overlay.
- A simple grid with explicit columns and fixed or weighted tracks. Full CSS track
  sizing is deferred.
- Common-height figure allocation as a named optional row policy. Solve straightforward
  aspect-only cases directly. If mixed text/figure fitting needs search, document the
  assumptions, bound the work, reuse prepared content, and retain the last known feasible
  result. Do not assume every custom layout response is monotonic.

Content-sized root dimensions are already implemented in stage 4. Their measured extent
becomes the SVG size directly, without a second implicit magnification. Fractional
dependencies on unresolved root axes follow the ordinary indefinite-reference rule.

**Milestone 7 makes the result assessable as a new core.** Keep a compact gallery centered
on the new API: an icon, a labeled shape, a wrapping paragraph, a padded card, a mixed row,
nested columns, baseline-aligned text, a wrapping set of cards, and a simple grid. Inspect
SVG output and representative browser rendering. The current outlined SVG does not
require installed fonts; browser font loading matters for a later native-text route.

Numerical checks should target contracts and composition: exact allocated sizes, finite
geometry, correct unit references, inset accounting, fractional sizes versus flex weights,
font inheritance, wrapping boundaries, and overflow/ink propagation. Include the previous
assessment's opposing clamp violations, differing-font allocations, and search-boundary
cases as regressions for the new algorithms. These are semantic references, not obligations
to reproduce old behavior. Profile layout-query counts and prepared-text reuse on nested
examples; avoid speculative optimization without an observed cost.

# Style Guide

Elegance! Things should be simple and beautiful. If you're adding more and more
special cases, something has probably gone wrong. Step back and rethink it.

Take an incremental approach. At each stage, try some sample probes or examples.
See if they produce reasonable output (tree, SVG, and PNG). Also consider if a
reasonable task is concisely expressible. If it's not, that may be a sign that
changes are needed.

Use the local rendering CLI, `bun scripts/gum.ts`, to rapidly try example code.
Browser work remains deferred. Build up the example gallery as you go so we can
both keep track of coverage.

1. Use snake_case for functions and PascalCase for class/type/interface names.
2. Keep variable names simple and one or two words (snake_case) if possible.
3. Avoid excessively long lines. Consider defining intermediate variables instead.
4. Make good use of Object packing/unpacking, using same-name assignment when possible.
5. Have comments every few lines describing what is being done. Have short comments
   at the top of functions describing their purpose.
6. For complex algorithms, you can have large multi-line block before the function elaborating the details.
7. Most files should follow the rough structure: imports, types, utility functions, class definitions, exports.
8. Testing is often good, but you don't have to write a test for everything.
