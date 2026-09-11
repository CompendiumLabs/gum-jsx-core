# Stages 1–3 gallery

Run `bun scripts/gallery.ts` from `src/next` to regenerate the files in `rendered/`.
SVG and PNG are generated from the same immutable fragment. The PNG conversion
uses `rsvg-convert`; no browser or old layout engine is involved.

| Example | What to inspect |
|---|---|
| [rectangle.jsx](./rectangle.jsx) | A 240×120 viewport; 0.75 width becomes 180px and 3em height becomes 60px. |
| [repeated.jsx](./repeated.jsx) | One source rectangle, two layouts, three placements, all with 3px strokes. |
| [clipping.jsx](./clipping.jsx) | Original, clipped, and explicitly transformed results; overflow survives clipping. |
| [protocol.ts](./protocol.ts) | Fixed, allocated, expanding, and width-dependent synthetic leaves. |
| [paragraph.jsx](./paragraph.jsx) | One styled paragraph at 408px and 224px; both use an 18px font and reuse prepared measurements. |
| [typography.jsx](./typography.jsx) | Faces, mixed-size baselines, tight leading, preserved whitespace, and line alignment. |
| [shapes.jsx](./shapes.jsx) | Rectangles, circles/ellipses, lines, polylines, polygons, and Bezier paths with 3px strokes. |
| [label.jsx](./label.jsx) | A 2em circle beside a separately sized 20px label. |

![One paragraph at two widths](./rendered/paragraph.png)

Compare the [SVG](./rendered/paragraph.svg) and [tree](./rendered/paragraph.tree):
the two columns have different line counts and identical glyph sizes. Text is
rendered as outlines with accessible labels, so PNG needs no installed fonts.

![Font metrics and line boxes](./rendered/typography.png)

The blue-gray rectangles show allocated line boxes; green lines show measured
baselines. The tight-leading sample keeps its full 28px glyph size and records
overflow. See its [tree](./rendered/typography.tree) for the separate ink bounds.

![Ordinary shapes](./rendered/shapes.png)

Every shape receives the same 128×80 allocation. Circle uses an inscribed 80px
diameter; Ellipse uses both axes. All strokes stay 3px wide.

![Independently sized circle and label](./rendered/label.png)

The stage 3 gallery uses small, explicit placement fixtures until the standard Box
and stack elements arrive. All source children are constructed before layout.

![One rectangle at multiple allocations](./rendered/repeated.png)

The first two rectangles share the same fragment. The third receives a different
exact allocation. Compare the [SVG](./rendered/repeated.svg) and
[tree](./rendered/repeated.tree): all three strokes remain 3px wide.

![Clipping and explicit transformation](./rendered/clipping.png)

The two clipped placements share a clip definition. The final placement applies
an explicit affine transform after layout. Its visible ink and its unclipped
overflow differ in the [tree](./rendered/clipping.tree).

![Synthetic layout policies](./rendered/protocol.png)

From left to right: a fixed 96×20 leaf offered 60×40; that same content allocated
60×40; an expanding leaf offered 60×40; six 1em cells at a width just below 32px;
and those cells at exactly 32px. The outlines show allocated boxes. The wrapping
fixtures have a 16px font basis and produce heights of 96px and 48px respectively.
These cells stand in for text measurement; they are solid rectangles, not glyphs.

The [unit and sizing probes](./contracts.ts) remain available through
`bun scripts/probe.ts`, including the stage 1 hugging and padding-overflow trees.
