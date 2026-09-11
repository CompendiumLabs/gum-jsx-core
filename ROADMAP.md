# Fresh core implementation roadmap

Build a new core around immutable element descriptions, explicit layout requests, and
immutable layout results. The first implementation covers SVG elements, ordinary shapes,
text, and composition through boxes, stacks, wrapping rows, and a simple grid. Math,
plotting, networks, slides, and migration of the add-on packages come afterward.

Stages 1–5 are implemented in [src/next](gum-jsx-core/src/next/README.md), with
unit and layout checks, JSX evaluation, measured and wrapping text, ordinary shapes,
Box/Frame/Fit composition, HStack/VStack/Spacer, a local rendering CLI, and an SVG/PNG/tree
[gallery](gum-jsx-core/src/next/examples/README.md). Stage 6(a), positioned Group, is
also implemented. Stage 6(b), wrapping stacks, is next.
Content-sized SVG dimensions moved forward into stage 4: a Box can hug a Square,
and Svg can hug the whole result, with one layout query per element. A fixed-width
SVG can also derive its height from a framed, wrapping paragraph.
The preceding assessment and motivation are preserved in [DESIGN.md](./DESIGN.md).

**The agreed direction is a Flutter/SwiftUI synthesis.** Parents control allocation and
position; children answer layout requests with geometry. A parent may make more than one
query, but queries do not reconstruct element definitions. Text style is resolved before
measurement. Intrinsic information is useful input to allocation, rather than a promise
that arbitrary layout behavior can be represented by two ranges and an affine aspect.

**The agreed unit rule applies to lengths.** A raw number is a fraction. `em(n)` and `px(n)`
construct immutable value/unit objects. All resolved layout geometry uses pixels.
Dimensionless values such as opacity, aspect ratio, and flex weights remain ordinary
numbers. `unit_size` and the separate stroke-unit system disappear.

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

**Several additional conventions are proposed here, rather than already agreed.** They
should be settled through the initial examples before implementation spreads across the
element library:

| Question | Proposed first-version rule |
|---|---|
| What is a pixel? | One SVG/CSS layout pixel at the document's normal display size. Raster pixel ratio changes sampling resolution, not layout. Changing viewport dimensions runs layout again. |
| What establishes the root size? | Explicit viewport dimensions use `px()`. Omitted axes hug the child's measured allocation, including any surrounding Boxes. This supports both natural sizing and content-sized height under a fixed width, without magnifying the result. |
| What does `em()` reference? | The element's resolved font size. While resolving `font_size` itself, `em()` references the inherited font size. A fraction used as `font_size` likewise references the inherited font size. |
| What does fractional width or height reference? | The corresponding axis of the parent's established content box, before allocating individual flex slots. A temporary measurement proposal does not change that basis. |
| What does fractional padding reference? | The corresponding axis of the containing content box: horizontal sides use its width; vertical sides use its height. These are outside references, not the box's own unresolved dimensions. |
| What does a fractional gap reference? | The stack's established content length along its main axis. A gap remains distinct from a flex weight. |
| What if that reference is indefinite? | Intrinsic queries keep the dependency explicit. Final layout requires a definite basis for a nonzero fraction and reports an element-path error when it cannot establish one. Zero needs no basis. General percentage-cycle solving is deferred. |
| What do fractional shape coordinates reference? | The shape's own resolved content rectangle. Scalar geometric lengths such as a circle radius, stroke width, or circular corner radius use its shorter side; two-axis radii resolve per axis. Arbitrary data-coordinate systems are deferred with plotting. |
| What do `Box.width` and `height` include? | The border box: content, padding, and border. Borders occupy space and draw inside the border box. For space outside the decoration, wrap the Box in another Box with padding. |
| Does making a box smaller scale its contents? | Ordinary layout reflows, constrains, or records overflow. An explicit `Fit` operation may scale a completed fragment, including its text and strokes. |

A finite available-space offer is not automatically a definite percentage reference. A
container that still hugs an axis cannot use its as-yet-unknown result as that axis's basis.
The initial rule deliberately makes such dependencies visible: use absolute lengths on
that axis or establish its size. This keeps the first engine free of implicit fixed-point
iteration. The reference basis travels separately from the trial allocation in a query.

**The execution model has three distinct objects.** An element stores the source
description; a layout pass owns resolved style, font resources, caches, and diagnostics;
a fragment stores the result for one request. The same element can appear twice, receive
different inherited styles or allocations, and produce independent fragments.

```ts
// Conceptual signatures; exact names are to be settled in milestone 1.
intrinsics(element, query, context): IntrinsicInfo
layout(element, request, context): Fragment
renderSvg(fragment, viewport): string
```

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

| Milestone | Deliverable | Completion example |
|---|---|---|
| 1. Contracts and units | Length values, reference rules, requests, sizing precedence, fragment schema, and small executable contract fixtures. | `px(10)`, `em(2)`, and `0.5` resolve predictably; missing fractional bases are distinguished from zero. |
| 2. Elements and SVG | Immutable descriptions, JSX/evaluation entry, layout-pass orchestration, fragment rendering, an explicit viewport, and a minimal rectangle. | One element renders twice at different sizes without changing its definition; stroke width stays at its specified pixels. |
| 3. Text and shapes | Real font measurement and wrapping, styled text runs, baselines, ink bounds, and the ordinary shape primitives. | A paragraph wraps at a pixel width and keeps its font size; a circle beside a text label has independently specified dimensions. |
| 4. Box composition | Shared sizing, padding, alignment, decoration, clipping, explicit fitting, and content-sized SVG dimensions; a convenient `Box` built from them. | A Box and Svg hug a Square. A framed paragraph changes line count as its width changes while border width, padding, and font size remain correct. |
| 5. Stacks | Horizontal and vertical flow, gaps, flex allocation, min/max clamps, alignment, baseline alignment, and explicit overflow. | A fixed-width label, growing paragraph, and fixed-size shape share a row correctly and nest in columns. |
| 6. Other core composition | Positioned groups/overlays, wrapping rows, a simple grid, and the optional common-height figure policy. | A compact document combines a proportional drawing, wrapping text, repeated cards, and shape rows without adapters. |
| 7. Stabilize the new core | Public API documentation, examples, diagnostics, numerical contracts, SVG inspection, and measured layout costs. | The examples form a small reference gallery and each supported behavior has a clear numerical contract. |

**Milestone 1 establishes semantics with a few concrete examples.** In addition to the unit
rules above, specify defaults for text size and line height, finite natural sizes for
unsized shapes, zero-size empty containers, and how explicit dimensions interact with
aspect and tight allocations. Keep these defaults in one place. Examples should include a
fixed viewport, a hugging text box, a half-width child, and insufficient space for padding.
Decide behavior before implementing separate elements that might interpret it differently.

Normalize length values centrally. Fractional allocation, growth weights, and scaling are
different concepts and receive different types or properties. Internal layout calls use
resolved pixel geometry; no element performs ad hoc em-to-parent or stroke-unit conversions.
Named inset fields avoid an overloaded tuple format that can mean either sides or mixed
units. Sizing inputs must distinguish an unknown dimension from a known zero dimension.

**Milestone 2 establishes a complete, small rendering path.** JSX and component evaluation
produce descriptions without measuring children. Layout resolves inherited style before
asking intrinsic questions, returns fragments, and caches by element identity, resolved
style, request, reference box, and relevant resource versions. Parents store child offsets
on their own result. Position-only changes do not trigger child measurement.

The SVG renderer consumes fragments, emits resolved geometry, and handles escaping,
definitions, and explicit transforms. It never performs layout or changes font metrics.
Clip identifiers and other drawing identifiers are assigned outside speculative queries.
This milestone also adds a tiny local render command and a textual fragment inspector so
every later stage is directly inspectable. Start with `Rect` and synthetic fixed, expanding,
and width-dependent leaves to exercise the protocol independently of fonts.

**Milestone 3 makes text a foundation of the containers.** Implement `Text` with plain and
styled runs (`Span`), inherited font family/weight/style/size, explicit newlines, word
wrapping, whitespace handling, and line alignment. Reuse font assets and suitable font
loading/measurement utilities through a small adapter; do not reuse the old text elements
or their reconstruction protocol.

Resolve font size once before measuring runs. Derive baselines and ink bounds from font
metrics, with a separately controlled line height and leading. A glyph extending beyond
the line box does not silently shrink its font. Separate prepared text from width-dependent
line layout so changing the width reuses font and run measurements. Cache exact requests
without rounding across line-break boundaries. Keep the font measurement contract
replaceable; advanced shaping and bidirectional text are not prerequisites for this first
core, whose initial text coverage uses the bundled faces and supported line breaking.

Build `Rect`, rounded rectangles, circles/ellipses, lines/polylines, polygons, and paths
alongside text. Define finite natural-size fallbacks, preferred aspects, fills, strokes,
and conservative ink bounds. Degenerate lines and empty shapes must remain finite.
Shapes without a preferred aspect fill offered axes independently; unoffered axes use
the finite natural fallback. Square and Circle supply a preferred 1:1 aspect. Rect and
Ellipse accept both dimensions of a rectangular viewport without explicit sizing props.
Resizing a shape's ordinary layout box changes its geometry without implicitly increasing
its pixel stroke width. Fitting a complete drawing is an explicit transform.

**Milestone 4 builds `Box` from shared operations.** Implement deflation/inflation for
insets, common size selection, child positioning, border/background geometry, clipping,
and uniform fitting. A `Box` has one layout content child; multiple children are composed
with a stack or overlay. Decoration does not determine content size. Begin with rectangular
and rounded frames; arbitrary decorative shapes can be composed explicitly.

Keep the rules for allocated box, border box, content box, and ink visible in the result.
Border geometry uses the same resolved thickness used by layout. An empty box is the size
of its insets and border, subject to its sizing request. Oversized insets cannot create
negative child dimensions. `Frame` can be a convenience preset. Text belongs in ordinary
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

**Milestone 5 implements ordinary stack allocation before special fitting policies.**
Use one main-axis/cross-axis implementation for `HStack` and `VStack`. Include intrinsic
packing, explicit sizes, fractional sizes, gaps, and `basis`/`grow`/`shrink` policies. Growth
is explicit metadata, not inferred from an infinite maximum. First determine fixed and
fractional allocations and gaps, then distribute the remaining space with min/max clamps.
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

**Milestone 6 completes ordinary graphical composition.** Add a positioned group with an
explicit viewport/reference rectangle, plus an overlay with an explicit content child and
non-sizing decorations. Numeric positions and extents use fractions of that established
rectangle. Positioning operates on fragments, without reconstructing element descriptions.
Keep reflow into a region distinct from fitting an already laid-out drawing into it.

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

Add wrapping rows using the same measured items and stack machinery. The initial grid has
explicit columns and fixed or weighted tracks; full CSS track sizing is deferred. Introduce
common-height figure allocation as a named optional row policy, not a hidden rule in every
stack. Solve straightforward aspect-only cases directly. If mixed text/figure fitting needs
search, document the assumptions, bound the work, reuse prepared content, and retain the
last known feasible result. Do not assume every custom layout response is monotonic.

Content-sized root dimensions are already implemented in stage 4. Their measured extent
becomes the SVG size directly, without a second implicit magnification. Fractional
dependencies on unresolved root axes follow the ordinary indefinite-reference rule.

**Milestone 7 makes the result assessable as a new core.** Keep a compact gallery centered
on the new API: an icon, a labeled shape, a wrapping paragraph, a padded card, a mixed row,
nested columns, baseline-aligned text, a wrapping set of cards, and a simple grid. Inspect
SVG output and a representative browser rendering with the intended fonts loaded.

Numerical checks should target contracts and composition: exact allocated sizes, finite
geometry, correct unit references, inset accounting, fractional sizes versus flex weights,
font inheritance, wrapping boundaries, and overflow/ink propagation. Include the previous
assessment's opposing clamp violations, differing-font allocations, and search-boundary
cases as regressions for the new algorithms. These are semantic references, not obligations
to reproduce old behavior. Profile layout-query counts and prepared-text reuse on nested
examples; avoid speculative optimization without an observed cost.

**Development stays isolated while the design settles.** The proposed location is
`gum-jsx-core/src/next`, exposed through an experimental entry point and its own tests and
examples. This avoids forcing math and the other packages to migrate before the new core
works. It is an isolation boundary for development, not a compatibility layer: new elements
do not inherit from the old `Element`, import its layout engine, or carry its `.em` records.

Source parsing, font assets, and independent utilities may be reused after
checking their dependencies. Keep the evaluation/resource environment thin; layout style
and parent information belong to the layout pass. The existing core remains available to
its consumers until a separate replacement/migration decision. No package-wide version
changes, default-export switch, publishing, or legacy cleanup belong to this roadmap.

The first useful checkpoint is milestone 4: a pixel-sized SVG containing a framed,
wrapping paragraph and basic geometry, with no constructor-driven layout. Milestone 5
proves the main composition protocol. Milestones 6 and 7 complete and stabilize the scoped
core before work begins on math or plotting.

# Style Guide

Elegance! Things should be simple and beautiful. If you're adding more and more special cases, something has probably gone wrong. Step back and rethink it.

Take an incremental appraoch. At each stage, try some sample probes or examples. See if they produce reasonable output (tree, SVG, and PNG). Also consider if a reasonable task is concisely expressible. If it's not, that may be a sign that changes are needed.

It makes sense to, at some point, stand up a rendering CLI command like "gum" to rapidly try out example code. Don't worry about the browser until we have things up and running. Build up an example gallery as you go so we can both keep track of coverage.

1. Use snake_case for functions and PascalCase for class/type/interface names.
2. Keep variable names simple and one or two words (snake_case) if possible.
3. Avoid excessively long lines. Consdider defining intermediate variables instead.
4. Make good use of Object packing/unpacking, using same-name assignment when possible.
5. Have comments every few lines describing what is being done. Have (short) comments at the top of functions describing their purpose.
6. For complex algorithms, you can have large multi-line block before the function elaborating the details.
7. Most files should follow the rough structure: imports, types, utility functions, class definitions, exports.
8. Testing is often good, but you don't have to write a test for everything.
