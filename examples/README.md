# Stages 1–4 gallery

Run `bun scripts/gallery.ts` from `src/next` to regenerate the files in `rendered/`.
SVG and PNG are generated from the same immutable fragment. The PNG conversion
uses `rsvg-convert`; no browser or old layout engine is involved.

The stage 4 sources use standard Box composition, with no placement fixtures:

| Example | What to inspect |
|---|---|
| [hugging.jsx](./hugging.jsx) | A 64px Square plus 16px padding and a 2px border makes a 100×100 Box and Svg. Neither parent specifies a size. |
| [card.jsx](./card.jsx) | A 360px viewport with content-sized height. The gallery also lays out the same source at 220px. |
| [nesting.jsx](./nesting.jsx) | Nested backgrounds, padding inside and outside a Frame, and a centered label. |
| [box_clip.jsx](./box_clip.jsx) | A centered 280px Square overflowing a 220×100 rounded Box, clipped inside its 6px border. |
| [fitting.jsx](./fitting.jsx) | Fit scales a natural text line to 280×80; Frame and Svg hug the result. |
| [fill_rect.jsx](./fill_rect.jsx) / [fill_ellipse.jsx](./fill_ellipse.jsx) | Unsized aspectless shapes accept both dimensions of a 200×100 viewport. |

![A Box and Svg hugging a Square](./rendered/hugging.png)

The [tree](./rendered/hugging.tree) records the content rectangle at `(18,18)`
and three layout queries suffice. The [SVG](./rendered/hugging.svg) uses these
pixel dimensions directly. No fitting transform is involved.

![A Rect filling a 200×100 viewport](./rendered/fill_rect.png)
![An Ellipse filling a 200×100 viewport](./rendered/fill_ellipse.png)

Neither shape specifies width or height. They accept the available dimensions
independently, as shown in the [Rect tree](./rendered/fill_rect.tree) and
[Ellipse tree](./rendered/fill_ellipse.tree). Square and Circle instead preserve
their preferred 1:1 aspect under the same offer. Box can also fill a finite offer
by hugging a child that expands to use the space inside its insets.

![A paragraph in a 360px card](./rendered/card.png)
![The same paragraph in a 220px card](./rendered/card_narrow.png)

Both cards have an 18px font, 18px padding, and a 2px inside border. Text changes
from seven to twelve lines; the document height changes from 216.4px to 342.4px.
Compare the [wide tree](./rendered/card.tree) and
[narrow tree](./rendered/card_narrow.tree). To try another width:

```sh
bun scripts/gum.ts examples/card.jsx --width 260 -o /tmp/card.png
```

![Nested boxes and external spacing](./rendered/nesting.png)

The [tree](./rendered/nesting.tree) distinguishes the inner Box's fixed 240×100
border box from Frame's padding and an enclosing Box with 8px padding. The outer Box
and Svg derive their full 314×166 dimensions from those contributions.

![Clipped overflow and a rounded inside border](./rendered/box_clip.png)

Clipping hides the overflowing Square while retaining its 280×280 allocation and
overflow in the [tree](./rendered/box_clip.tree). Its painted ink is bounded by
the inside of the border. The outer Box's 12px padding contributes to Svg's 244×124 size.

![Explicit fitting of a completed text line](./rendered/fitting.png)

The [fitting tree](./rendered/fitting.tree) keeps the original 16px text geometry
under one uniform transform. Fit fills the offered width while preserving aspect;
the Frame adds its own 16px padding and 2px border afterward.

The earlier protocol, text, and shape examples remain available:

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

The stage 3 gallery retains small, explicit placement fixtures. Standard stacks
arrive in stage 5. All source children are constructed before layout.

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
