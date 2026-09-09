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

`text_metrics` (`src/lib/text.ts`) measures a string with opentype.js at a 1em font and
returns the measurement as it is, a `TextMetrics`:

- `advance` — the width of the run, in em
- `ink` — the ink extents, y-up and baseline-relative, say `[-0.2, 0.75]` for a string with
  descenders (`font_vertical`)
- `italic` — the italic correction (how far the last glyph overhangs its advance), for math

How the run is framed is the `Span`'s business, decided in its constructor. It keeps only
what it needs to draw, its `glyphs`: the font `size` in its frame's units and the `y` of the
`baseline`. Nothing else reads the measurement afterwards.

### The line frame

By default (`frame: 'line'`) a Span is the 1em line box it sits in, `[0, 1]` y-down, and its
aspect is its advance:

- If the ink is taller than 1em (as with some KaTeX glyphs) the line is taken as the ink
  height and the font is scaled down by `size = 1 / line_height` to stay inside it, set a
  quarter down; otherwise the font is one em and sits on the bottom.
- Baseline-at-the-bottom leaves text looking low in its box, so the font is shifted up by
  `TEXT_AXIS` (`-0.15`, `src/lib/const.ts`): the baseline lands at `0.85` of the line box.
  This is the one number that decides where text sits in a line, and it is shared with the
  math placement below. It is a constant, not a per-span argument.

A line span has no em box of its own: a line places it by its advance. When something asks
for one (an element adapted with `with_em`, or a stated `metrics`) it is the line it draws
in: 1em tall, as wide as its advance, anchored a quarter of the font above the baseline
(`text_em`), which is `INLINE_MATH_AXIS`, where a line places a formula beside it.

### The ink frame

With `frame: 'ink'` the run's ink about the math axis is both its coordinate frame and its
em box (`bounds_em`), so an assigned rect scales the glyph with its box. `axis` puts the
baseline a quarter em below the axis (TeX Rule 13) or centers the ink on it (large
operators, delimiters). The font is 1em in that frame. This is what `@gum-jsx/math` builds
its glyph atoms on (`MathSpan`). A run with no ink keeps the line frame, with the line's box.

### Rendering a Span

`Span.props()` is the only consumer of `glyphs`. It maps the font box without the text
shift, `[0, baseline - size - TEXT_AXIS, 1, baseline - TEXT_AXIS]`, through the context to
pixels, takes its pixel height as `font-size`, and emits the baseline at
`y = y0 + (1 + TEXT_AXIS) * h`, so the shift points down on screen whatever the frame's
orientation. That is the whole mechanism: `glyphs` tells a Span what `font-size` and `y` to
write, and nothing else reads it.

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
