# Stage 2 gallery

Run `bun scripts/gallery.ts` from `src/next` to regenerate the files in `rendered/`.
SVG and PNG are generated from the same immutable fragment. The PNG conversion
uses `rsvg-convert`; no browser or old layout engine is involved.

| Example | What to inspect |
|---|---|
| [rectangle.jsx](./rectangle.jsx) | A 240×120 viewport; 0.75 width becomes 180px and 3em height becomes 60px. |
| [repeated.jsx](./repeated.jsx) | One source rectangle, two layouts, three placements, all with 3px strokes. |
| [clipping.jsx](./clipping.jsx) | Original, clipped, and explicitly transformed results; overflow survives clipping. |
| [protocol.ts](./protocol.ts) | Fixed, allocated, expanding, and width-dependent synthetic leaves. |

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
