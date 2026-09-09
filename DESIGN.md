# `gum.jsx` Design

Notes on the design of the core library: the conventions that hold the pieces together but
are not obvious from any one file. This is a work in progress; sections are added as they are
written up.

## Fonts

### The line box

Text is laid out by convention rather than by measurement at layout time. Every `Span` is a
**1em line box**: an element whose height is one line and whose width is the text's advance,
so `aspect = advance` (in em). The font's em square sits at a fixed position inside that box,
and because every Span in a line uses the same position, a plain `HStack` of Spans lines up
baselines automatically. No layout container ever consults a text metric.

### Metrics

`text_metrics` (`src/lib/text.ts`) measures a string with opentype.js and normalizes the result
into the line-box frame (`normalize_text_metrics`):

- `fontVertical` returns the ink extents of the string in em, y-up and baseline-relative, say
  `[-0.2, 0.75]` for a string with descenders.
- If the ink is taller than 1em (`ymax - ymin > 1`, as with some KaTeX glyphs) the line box
  is taken as the ink height and the font is scaled down by `font_height = 1 / line_height`
  to stay inside it; otherwise the font is one em and `font_height = 1`.
- The baseline is placed at the bottom of the box, `y = 1` in the box's y-down `[0, 1]` frame.

The result is a `TextMetrics`:

- `advance` — width in units of the line-box height, which is the Span's aspect
- `vrange` — where the **em square** sits: `[baseline - font_height, baseline]`
- `raw_vrange` — where the **ink** sits: `[baseline - ymax * font_height, baseline - ymin * font_height]`
- `italic` — the italic correction (how far the last glyph overhangs its advance), for math

`raw_text_metrics` is the inverse, recovering the measured ink in em from the normalized
metrics; `@gum-jsx/math` uses it for tight ink boxes (`MathText`).

### The vertical shift

Baseline-at-the-bottom leaves text looking low in its box, so `Span` shifts the metrics by
`vshift` (default `TEXT_AXIS = -0.15`, `src/lib/const.ts`): both ranges move up by 0.15 and the
baseline lands at `0.85` of the line box. This is the one number that decides where text sits
in a line, and it is shared with the math placement below.

### Rendering a Span

`Span.props()` is the only consumer of `vrange`. It maps the unshifted em square
`[0, ymin - vshift, 1, ymax - vshift]` through the context to pixels, takes its pixel height as
`font-size`, and emits the baseline at `y = y0 + (1 + vshift) * h`. That is the whole
mechanism: `vrange` tells a Span what `font-size` and `y` to write, and nothing else reads it.

### Lines and paragraphs

`TextLine` is an `HStack` of Spans (and `ElemSpan`s) with `aspect = width` when wrapping, and
`Text` is a `VStack` of `TextLine`s with `even: true`, so every line is a line box of the same
height and line *n* occupies the *n*th slice of the paragraph. Widths given as `width` are in
em because the line box is one em tall: a `Text` with `width = 25` is 25em wide and one em per
line, which is how text in different containers (`TextStack`, `Bullets`, `Slide`) comes out the
same size when given the same `width`. With a nonzero line `spacing` the paragraph is taller,
but each line box is still one em; the first line is always the top em of a `Text`.

### Inline elements and math

Non-text children of a `Text` are wrapped in an `ElemSpan`, which is also a 1em line box: an
arbitrary element is centered in it (the `HStack` default), while an element carrying em
metrics (`lib/em.ts`: a `width`, `height` and `anchor` in em, the anchor being the math axis;
the math elements carry them as their `MathSpec`) is placed by them (`place_inline_em`). One em
of its content is one line height, its anchor is pinned to `INLINE_MATH_AXIS = 1 + TEXT_AXIS - MATH_AXIS`
(`0.6` of the line box, `MATH_AXIS = 0.25` being the axis height above the baseline), and a tall
formula overflows the line rather than shrinking, as in TeX. This is the only place vertical
alignment is done from metrics, and the metrics involved are the em record's, not the Span's.

### Font faces

Text is measured by a font's registry name but named in the output by its css face
(`fontFace`, `src/fonts/fonts.ts`): the bold and italic KaTeX faces are registered one name
per file for measurement and emitted as the base family plus `font-weight`/`font-style`,
which is how browsers and fontconfig find them. See `CLAUDE.md` for loading and registration.
