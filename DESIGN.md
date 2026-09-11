# Gum Design Report

## Current decisions through stage 6(a)

This directory is the fresh core implementation, exposed as `@gum-jsx/core`.
Stages 1–5 and 6(a) are complete: units, the element/layout/fragment protocol,
SVG rendering, text and shapes, Box/Frame/Fit, HStack/VStack/Spacer, and Group.
[README.md](./README.md) documents the implemented API and development workflow;
[ROADMAP.md](./ROADMAP.md) records progress and the remaining work. Wrapping stacks
are the next planned slice, 6(b). The rest of stage 6 and stabilization remain pending.

The original prompt and assessment below concern the **legacy** implementation in
`src/elems` and `src/lib`. References to “current,” “today,” old bugs, and measurement
counts in that assessment describe the reviewed legacy version. They are preserved
as motivation, not as instructions to recreate its APIs or as findings about `next`.
The final decisions made during implementation are:

| Topic | Implemented decision |
|---|---|
| Layout protocol | Flutter's separation of responsibilities with SwiftUI-like requests. Immutable source elements answer `natural`, `available`, and `exact` requests with immutable fragments. Parents own allocations and placement. |
| Element definition | Keep `define_element(name, layout, defaults?)`. Constructors snapshot data; layout never clones or reconstructs elements. Defaults become ordinary source props, as used by Spacer. |
| Intrinsics | Use the same layout method with natural axes and any known cross-axis offer. There is no separate `intrinsics()` API, bounds interface, symbolic affine solver, or general search. |
| Units | Raw **length** numbers are fractions; `em()` and `px()` produce value/unit objects. Requests and resolved geometry are pixels. Flex weights, anchors, and aspect ratios are dimensionless numbers. No unit strings, `unit_size`, or implicit magnification. |
| Reference boxes | Established parent dimensions travel separately from trial allocations. A hugging axis stays indefinite. Group and Fit explicitly select finite axes from offers and can establish references that way. |
| Ownership | “Keep the layout pass ice cold.” LayoutPass resolves style/sizing and owns queries, caches, resources, and diagnostics. Containers interpret their own policies and direct-child metadata. |
| Spacing and decoration | Box has one content child; its width includes padding and its inside border. External spacing uses another Box's padding. There is no shared margin prop, automatic wrapper, or built-in Box overlay behavior. |
| Stacks | Growth and shrinkage are explicit, both defaulting to zero. Basis, preferred sizes, and min/max resolve in the child's local font. Fractional lengths remain distinct from flex weights. Text reflows at allocated widths. |
| Positioned composition | Group selects a finite canvas before child layout, then reads direct-child `x`, `y`, and `anchor`. It does not hug child bounds or infer a baseline. Unresolved canvas axes are errors, even when empty. |
| Scaling and SVG | Fit explicitly scales a completed fragment, including glyphs and strokes. Ordinary layout reflows or resizes. The SVG serializer removes identity/attribute-free groups while preserving meaningful transforms, labels, and clips. |
| Text | Glyph outlines and accessible labels are implemented. Native selectable SVG text and automatic font fitting remain deferred. |

Several legacy failure modes have executable references in the new core:
[unit and sizing contracts](./test/contracts.ts), [style and query identity](./test/engine.ts),
[text reflow and prepared-measurement reuse](./test/text.ts), and
[opposing flex clamps and extreme weights](./test/flex.ts). Stack behavior is exercised
in [test/stack.ts](./test/stack.ts). The old common-height search is not present; its
reported boundary bug is a caution for a future optional fitting policy, not an
unfixed search in `next`.

## Original prompt and assessment (legacy implementation)

Legacy-source links below are navigation aids into the sibling source directories;
they are not pinned snapshots. The original measurements remain historical.

### User prompt

So we've mostly made the transition here to allowing for things to specified in "em" units. It's really nice in a lot of ways. Gives you something like flex-box style outside-to-inside layout, rather than the core gum inside-to-outside layout. Still, the implementation still strikes me as a bit inelegant and pretty grungy in certain points. For instance, the Box implementation just seems wildly overcomplex for what it's supposed to do: padding, border, margin.

Can you look through the gum-jsx-core layout implementation (mostly core.ts, layout.ts, em.ts in src/elems and src/lib). There's basically this process where children give bounds to the parent, get an offer in reply, then place themselves based on that offer. The big question is, is this the right approach and is this the right way to implement such a protocol.

I'm also feeling some friction from mixing between pixels, fractional units, and em units. It's a little confusing to the user. Alternatives would include going CSS style with px/em string suffixes with pure numbers as fractions. That may or may not intersect with the layout protocol analysis.

Can you think deeply about this, drawing inspiration from other implementations like flutter or CSS flexbox? Give me an assessment of the current approach and provide some alternatives, listing their pros and cons. Let's go!

### Assessment

**I would keep the two-way layout protocol, but change how it is represented and executed.** It suits Gum’s combination of figures, text, and mathematics. The biggest improvements would come from separating element construction from layout, making sizing policies explicit, and reducing `Box` to a composition of smaller operations.

The unit API deserves a cleanup too. But layout direction and units are independent: `em` makes typography consistent; the offer mechanism is what lets content respond to available space. The same protocol could operate in pixels.

I traced the core files, plus `box.ts`, text, the SVG entry point, and the em tests. The existing em checks pass. Some focused probes uncovered problems that help distinguish architectural issues from implementation bugs.

The current protocol has a sound foundation
------------------------------------------

The public interface is essentially:

```ts
bounds(): Bounds
lay(offer: Offer): Laid
```

A parent asks what its children can do, allocates space, asks them to lay out for that allocation, and positions the returned results. Despite its name, `place()` mostly computes the child’s response; the enclosing layout still chooses its position. That division is appropriate. [Legacy implementation](../elems/core.ts)

There are several things I would preserve:

- The layout engine works against a small `LayoutItem` interface, largely independently of SVG elements.
- Most layout arithmetic already uses one consistent unit: the parent’s em.
- Layout bounds, ink overhang, and mathematical anchors are distinguished. This is necessary complexity for good mathematical composition.
- The affine aspect relation is useful. Adding padding around a figure really does change `w = a·h` into `w − ox = a·(h − oy)`.

The issue is that this compact interface currently promises more than its representation can reliably express.

**`Bounds` mixes intrinsic measurements with behavior.** The parent interprets `maxHeight === Infinity` as flexibility, and flexibility without an aspect as an ability to absorb spare space. Those are policies inferred from measurements. An element that can grow up to a finite maximum does not fit that classification naturally. The later addition of `stretch` already moves toward explicitly describing behavior. [Bounds and classification](../lib/layout.ts)

Also, these bounds are not necessarily limits on the actual result. A measured element reporting a fixed `10 × 2` box can return `5 × 1` when offered a width of 5. That may be desirable, but it means the record describes something closer to intrinsic size preferences than an exact set of permitted sizes.

**The affine representation is not closed under all the compositions the engine supports.** Wrapping text gives a staircase-shaped height function. Clamps, competing children, and differing margins introduce piecewise relationships even without text.

I confirmed a particularly revealing case: a column containing two half-share aspect boxes with different margins reports an affine relation predicting a height of **24em at a width of 12em**, while its actual layout returns **8em**. The child controlling the result changes with width; a single aspect and offset cannot describe the whole response. [Composition logic](../lib/layout.ts)

I would retain those relations as optimizations where they are valid, with actual layout remaining authoritative.

Where the implementation becomes expensive
------------------------------------------

**Layout is implemented through reconstruction.** The path is:

```text
lay → place → relay → clone → rebuild → constructor → child layout
```

The documentation explains this in terms of JSX constructing children before parents. That explains why the current constructors cannot receive parent information; it does not require layout to happen in constructors. The JSX tree can be constructed first and laid out afterward. [Reconstruction path](../elems/core.ts)

The shallow placement clone is a sensible optimization within the current design. But subsequent layout offers still run constructor work again.

For one square-plus-paragraph row, a single `lay({width: 12, height: 10})` rebuilt `Text` **43 times** while searching for an allocation. Glyph shaping is already cached, so this is not 43 completely fresh font-shaping operations. It is still repeated reconstruction and wrapping. Simple nested boxes behaved linearly in my probe; the repetition was concentrated in searches and construction of nested, unconstrained stacks. [Row search](../lib/layout.ts)

**Inherited style arrives too late for some measurements.** Parents inspect `bounds()` before supplying inherited font settings through the offer.

For example, `"iiiiii"` initially measures 1.458em in the default face, but 3.6em in the inherited monospace face. A row of that text and a square allocates using the first measurement and renders using the second. Specifying the same font directly on the child produces a different allocation and avoids the overflow.

This is a strong reason to resolve inherited style before intrinsic measurement. Merely caching today’s `bounds()` results would preserve the wrong measurement.

**`Offer` carries several different kinds of information.** It contains available dimensions, requirements to fill those dimensions, fitting behavior, alignment, and inherited text settings. Whether an offered dimension is a budget or the resulting box’s size then depends on the element receiving it. [Offer definition](../lib/layout.ts)

These distinctions are legitimate. They need a clearer representation and ownership.

Why `Box` is so large
--------------------

Your intuition about `Box` is right, but its actual responsibilities extend considerably beyond padding, border, and margin.

It currently handles:

- Content measurement and inherited text settings.
- Hugging, explicit dimensions, stretching, aspect sizing, and flexible filling.
- Fitting content versus allowing it to reflow.
- Selecting the first content child as the sizing child.
- Treating other children as overlays or decorations, including special placement by `pos`.
- Backgrounds, borders, clipping, masks, and rotated-box behavior.

That is a substantial container abstraction. [Box implementation](../elems/box.ts)

A padding primitive should have approximately this algorithm:

1. Subtract its insets from the child’s available space.
2. Lay out the child.
3. Add the insets to the returned size.
4. Offset the child and its anchor.

Margin is another inset operation outside the decorated frame. Decoration draws against the resulting frame. Explicit sizing, alignment, and aspect fitting can each be separate operations.

Conceptually:

```text
Margin → Frame decoration → Padding → Content
```

Optional sizing, fitting, and overlay operations attach at defined points in that composition. The public `<Box padding border margin …>` convenience can remain, and the implementation need not allocate a runtime object for every conceptual operation.

Two details need explicit preservation or deliberate change:

- **Today, `Box.width` includes margin, while border thickness does not participate in its inset arithmetic.** This is not CSS’s border-box sizing convention.
- **Only the first unpositioned child determines the natural size.** That is a primary-content-plus-overlays model. Giving those roles explicit internal names would make the implementation considerably easier to understand.

The border’s shape and clipping geometry can remain shared, without making the same function responsible for negotiating the content’s size.

What the other systems suggest
------------------------------

**Flutter provides a cleaner contract by imposing stronger rules.** Parents send minimum and maximum dimensions; children return a size within them; parents choose positions. Tight constraints express an exact size, and loose constraints permit a smaller result. Its ordinary layout combines downward constraints and upward geometry in one recursive traversal. [Flutter’s layout model](https://docs.flutter.dev/resources/inside-flutter)

Its padding implementation really is essentially “deflate constraints, lay out child, offset child, inflate size.” [RenderPadding](https://api.flutter.dev/flutter/rendering/RenderPadding/performLayout.html)

However, Flutter’s simplicity has a price. Flex children receive allocations according to explicit flex factors. Gum’s automatic common-height figures and joint figure/text fitting require additional policy. Intrinsic queries remain available in Flutter, but speculative intrinsic layout can introduce quadratic work. Adopting Flutter’s terminology alone would not eliminate Gum’s repeated measurements. [RenderFlex](https://api.flutter.dev/flutter/rendering/RenderFlex-class.html), [IntrinsicHeight](https://api.flutter.dev/flutter/widgets/IntrinsicHeight-class.html)

**SwiftUI is an especially close comparison.** Children respond to size proposals, and parents can probe multiple proposals before deciding on placement. Its API explicitly provides caching between sizing and placement. This accepts negotiation as part of the model without requiring each child to summarize its entire behavior as a rectangular range plus an aspect. [Size proposals](https://developer.apple.com/documentation/swiftui/proposedviewsize?changes=la%2Cla), [Sizing and caching](https://developer.apple.com/documentation/swiftui/layout/sizethatfits%28proposal%3Asubviews%3Acache%3A%29)

**CSS flexbox offers useful allocation rules, rather than a universally simpler engine.** It separates intrinsic contributions, flex basis, growth, shrinkage, minimums, maximums, and alignment. Its allocation loop clamps and freezes items before redistributing space. It also has multiple stages and circumstances requiring another layout of the contents. Gum’s equal-height treatment of aspect figures is a distinct policy worth preserving where useful. [Flex layout algorithm](https://www.w3.org/TR/css-flexbox-1/#layout-algorithm)

These lead to four credible alternatives:

| Approach | Pros | Cons |
|---|---|---|
| **Refactor the current protocol** | Preserves existing diagrams and automatic behavior; can proceed incrementally; retains analytic aspect calculations. | Must clarify what bounds mean and explicitly handle cases their representation cannot express. |
| **Flutter-style constraints** | Strong invariants; small composable primitives; clear ownership of sizing and positioning. | Changes how explicit sizes and overflow interact; some convenient Gum layouts need extra policies or intrinsic queries. |
| **SwiftUI-style proposals and responses** | Small general interface; naturally handles width-dependent text and custom elements; avoids requiring exact symbolic bounds. | Potentially many probes; caching and allocation policy still matter; proposals provide weaker guarantees than constraints. |
| **CSS-oriented flow engine** | Established sizing vocabulary; reusable implementations such as [Taffy](https://github.com/DioxusLabs/taffy); supports broader document layout. | Significant behavioral migration and integration work; Gum’s geometry, mathematical anchors, and figure composition still need adapters. |

A general constraint solver is another possibility, particularly for linear relationships among figure dimensions. I would not choose it as the default text-layout engine: line breaks and changing intrinsic sizes introduce discrete decisions that a linear solver does not resolve by itself.

What I would build toward
------------------------

**My preference is a Gum-specific proposal-and-response engine, with optional intrinsic hints and a separate layout result.** Borrow Flutter’s separation of responsibilities and SwiftUI’s explicit acceptance of measurement queries.

A conceptual interface could be:

```ts
intrinsics(context, query): IntrinsicHints
layout(request, context): Fragment
```

Here:

- `context` contains resolved typography and unit conversions.
- `request` distinguishes natural sizing, available space, and an exact allocated box.
- `Fragment` contains the resulting box, anchor, ink bounds, and positioned child fragments.
- Element definitions remain independent of the fragments produced for particular requests.

“Available 10em” would mean “lay out with this budget and report what you need.” “Exactly 10em” would mean the allocated box is 10em; content overflow is recorded separately. Keeping that distinction explicit avoids hiding it behind combinations of `fill`, `vfill`, and element-specific behavior.

This need not imply three whole-tree passes. Containers can still recurse normally, make extra queries when their algorithm requires them, and reuse the selected result for placement.

I would also:

- Resolve inherited style before measuring.
- Separate growth and shrinkage policies from intrinsic min/max measurements.
- Retain affine sizing information only where composition preserves it.
- Reuse prepared text and layout results instead of rebuilding element constructors.
- Keep the common-height figure allocation as an identifiable stack policy.
- Preserve the last known fitting result during searches, particularly around text-wrap discontinuities.

That gives custom elements a straightforward requirement: explain their intrinsic preferences when useful, then return a reliable result for a concrete request.

The unit question intersects at the reference bases
--------------------------------------------------

There is real inconsistency in the public API today:

| Property or context | Meaning of a number |
|---|---|
| `Box.padding`, `Box.margin`, layout `width`, `gap` | Em |
| Stack `share`, `spacing` | Fraction of stack length |
| Slide padding and margin | Fraction of slide height |
| Geometry inside a coordinate frame | Coordinate units |
| Border width and corner radii | Stroke units |

In particular, the last category is not simply output pixels. `Svg` establishes a stroke unit from rendered size divided by `unit_size`; that unit scales with the image. Meanwhile, the em offer is established before the resulting figure is fitted to the output size. [SVG sizing and units](../elems/core.ts)

Explicit suffixes would make many examples easier to read. There are three reasonable policies:

| Unit API | Pros | Cons |
|---|---|---|
| Keep existing numeric meanings; add `"em"` and `"px"` | Easy migration; existing examples work. | Numbers remain dependent on the property and container. |
| **Numbers mean fractions; lengths use suffixes** | Clear visual distinction between relative and absolute lengths; attractive for proportional diagrams. | Breaking change; fractions need precise reference rules, especially during intrinsic sizing. |
| Require explicit units for layout lengths; keep numeric coordinates and allocation factors | Most explicit; avoids accidental reinterpretation of existing numbers. | More verbose JSX. |

**I lean toward the third policy for new layout APIs**, with `em(n)` and `px(n)` helpers for programmatic expressions. Your numbers-as-fractions proposal is also coherent if confined to layout lengths.

I would preserve numeric geometry coordinates. In a graph with a custom coordinate system, `x={5}` should continue to mean coordinate 5. Calling every naked number a fraction would erase an important part of Gum’s graphics model.

There are three semantic decisions to settle before implementing suffix parsing.

**1. A fraction needs a specified reference box.**

For `width={0.5}`, is that half the parent’s available width or half its eventual content width? Those differ when the parent hugs its children.

Fractional gaps already make this visible. With content length \(C\), \(n\) children, and gap fraction \(g\):

\[
L = C + (n-1)gL
\quad\Rightarrow\quad
L = \frac{C}{1-(n-1)g}
\]

Gum already solves versions of this equation. Extending fractions to arbitrary padding and sizes introduces more dependencies, sometimes involving wrapping text.

You need a policy for indefinite reference sizes: solve supported cases, defer the percentage, treat it as intrinsic/auto, or require a definite parent size. CSS has explicit cycle-breaking rules; adopting its syntax does not remove this decision. [Cyclic percentage sizing](https://www.w3.org/TR/css-sizing-3/#cyclic-percentage-contribution)

**2. A fraction and a flex weight are different.**

`share={0.5}` currently means half the gross stack length. A growth weight of 1 means a proportion of the space available for distribution.

Two half-width children plus a gap overflow their parent. Two equal flex allocations can divide the space remaining after the gap. I would keep these as separate concepts, with names that make the distinction apparent.

**3. `px` needs a stable meaning across layout and export.**

I would define it as a document/layout pixel and treat export scaling separately. A fixed viewport could preserve those dimensions; fitting a completed figure would explicitly scale the entire drawing.

Simply renaming today’s stroke units to `px` would leave unresolved interactions with `unit_size` and automatic figure fitting.

For `em`, use the element’s resolved font size as the reference and keep line spacing separate. That follows the familiar CSS meaning. [CSS font-relative units](https://www.w3.org/TR/css-values-4/#font-relative-lengths)

Internally, normalize length syntax into tagged values, resolve them when their reference bases are known, and let the layout arithmetic continue using numbers. No full CSS parser is necessary.

I would start with a few concrete changes
----------------------------------------

The first work should establish the contracts and fix the counterexamples before changing public numeric meanings:

1. Resolve typography before intrinsic measurement.
2. Separate layout results from constructor reconstruction, beginning with text and boxes.
3. Extract inset, decoration, sizing, and overlay operations.
4. Introduce explicit unit syntax with a documented migration policy.

Two smaller correctness bugs also emerged independently of that redesign:

- `distribute(10, [[7, 9], [0, 3]])` returns `[5, 5]`: opposing clamp violations cancel, and the algorithm returns the unclamped allocation.
- The row search can return the failing side of a text-wrap boundary. My 12-by-10 example found a fitting allocation but ultimately returned an 11em-high result.

Those warrant focused regressions regardless of the architectural direction. The original
scratch probe, `/tmp/gum-layout-review.ts`, captured these cases, the font issue,
reconstruction counts, and the affine mismatch. It was not checked into this repo;
use the maintained tests linked above for the new implementation. Repository source
was unchanged during that original assessment.
