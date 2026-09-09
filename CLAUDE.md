# `gum.jsx` Framework

`gum.jsx` is a language for creating visualizations using a React-like JSX dialect that evaluates into SVG. It's designed for creating general graphics, plots, graphs, and network diagrams. The language supports declarative component-based rendering with automatic layout and coordinate system mapping.

## Commands

### Running the CLI

The `gum` command (and `gum-tex`, `gum-mark`) is shipped by the batteries-included `gum-jsx`
package (`../gum-jsx`); install it globally or run `bun scripts/gum.ts` there. To test the output
of a `gum.jsx` snippet or file, pipe it to `gum`. If you have vision capabilities, this can be
useful for seeing the actual output of the code, either in SVG or PNG format.

```bash
# Generate SVG from a gum.jsx snippet
echo '<Rectangle rounded fill={blue} />' | gum -f svg

# Generate PNG from a gum.jsx snippet and save to file
echo '<Rectangle rounded fill={blue} />' | gum -o test.png

# Generate SVG/PNG from a .jsx file
gum ../gum-jsx-docs/docs/code/Box.jsx -o test.svg

# Run options:
# file: gum.jsx file to render (reads from stdin if not provided)
# -s, --size <size>        size of the svg/viewBox (default: 1000)
# -u, --unit-size <size>   image size at which stroke_width = 1 is one pixel (default: 1000)
# -r, --raster-size <size> max rasterized PNG size (default: null)
# -f, --format <format>    format: svg, png, kitty, layout, json (default: kitty or inferred)
# -z, --zoom <region>      region to zoom into, as x0,y0,x1,y1 fractions of the figure
# --depth <levels>         layout format: levels below the root to list (default: 4)
# --select <text>          layout format: only elements whose path, type, id, or class contains this
# -t, --theme <theme>      theme to use (default: dark)
# -b, --background <color> background color (default: white for light, none otherwise)
# -o, --output <output>    output file (default: null)
# --strict                 throw on rendering fallbacks instead of drawing them
# --seed <seed>            seed for random/uniform/normal/integer (default: 42)
```

### Packages

This repo is `@gum-jsx/core`: the JSX → SVG evaluator, the core elements, and the fonts — a
pure, platform-neutral library with no CLI. Everything under
`@gum-jsx/*` is a library; the batteries-included `gum-jsx` package (`../gum-jsx`) depends on
all of them and ships the CLIs and the test suite. The siblings, each its own repo and npm
package versioned in lockstep with core, and resolved to the sibling checkouts through the
`gum-org` bun workspace during development (see `../CLAUDE.md` and their `CLAUDE.md`s):

- `@gum-jsx/math` (`../gum-jsx-math`): the LaTeX elements (`Latex`, `Tex`, `MathArray`, …), the
  KaTeX faces, `mathToSvg`/`mathToPng`.
- `@gum-jsx/node` (`../gum-jsx-node`): the node runtime — `rasterizeSvg`/`rasterizePixels` via
  node-canvas, kitty `formatImage`, `ansi`, `readStdin`. Core has no `canvas` dependency.
- `@gum-jsx/mark` (`../gum-jsx-mark`): Markdown → terminal rendering (`displayMarkdown`).
- `@gum-jsx/docs` (`../gum-jsx-docs`): the documentation and gallery examples (`docs/`, `gala/`),
  the loaders that index them, and the Claude skill built from them (`skills/gum-jsx`, by its
  `scripts/skill.ts`) — content only, with no dependency on core.
- `gum-jsx` (`../gum-jsx`): re-exports all of the above (`gum-jsx`, `gum-jsx/eval`, `gum-jsx/math`,
  `gum-jsx/render`, `gum-jsx/mark`, `gum-jsx/meta`), the `gum`/`gum-tex`/`gum-mark` bins, the
  strict-mode test runner (`gum-jsx/test`), the feature tests in `test/code`, and the report
  app.

An add-on is an `EnvPlugin` (its elements, bindings and fonts) that a host applies to an `Env`
(below), and reaches core internals through the subpath exports `@gum-jsx/core/env`,
`@gum-jsx/core/lib/*`, `@gum-jsx/core/elems/*`, `@gum-jsx/core/fonts`, `@gum-jsx/core/eval`,
`@gum-jsx/core/inspect` and `./package.json` — that is the surface core commits to.

### Testing

Run type checking:

```bash
bun tsc --noEmit
```

The tests live in `gum-jsx` (`../gum-jsx`): its suite starts with the Env checks (`test/env.ts`
there — settings never leak between evaluations, plugins and derived Envs are isolated, seeds
and ids behave) and then renders every example.

The example suite lives in `gum-jsx` (`../gum-jsx`): `bun test/run.ts` there renders every
example in `@gum-jsx/docs` (`../gum-jsx-docs`: `docs/code/`, `gala/code/`) plus its own
`test/code/` in **strict mode**
(`src/lib/strict.ts`), which turns the permissive rendering fallbacks into thrown `StrictError`s
so silent breakage shows up as a failure: unparseable TeX (`parse`), a katex node with no gum
equivalent (`node`), an unknown command name drawn verbatim (`symbol`), a TeX font command with
no gum face mapped (`font`), and a character missing from the resolved face (`glyph`). Strict
mode is **off by default** everywhere else; it is a `strict` flag on `evaluateGum` and `--strict`
on the CLIs. An example that deliberately exercises a fallback opts out with a `@nostrict`
comment. `bun test/run.ts --report` there also writes every render to `test/data` for the
`test/report` browser (`bun run report`).

Or test a single file:
```bash
gum ../gum-jsx-docs/docs/code/Box.jsx -o test.svg
```

## Architecture

### The Env

There is no process-global state. An **`Env`** (`src/env.ts`) is everything gum.jsx code runs
against, and every element carries the one it was built with:

- **Registries**: `elems` (element constructors by JSX tag name), `bindings` (constants and
  utilities bound as globals of evaluated code) and `fonts` (a `FontRegistry`, below). `new Env()`
  starts with core's (`corePlugin`: `CORE_ELEMS`, the constants and utilities, the text fonts);
  `use(plugin)` adds an `EnvPlugin` (`{ elems?, bindings?, fonts? }`) — `@gum-jsx/math` exports
  `math` this way, and `registerElements`/`registerBindings`/`registerFonts` add one kind.
- **Settings**: `theme`, `strict`, and two random streams — `rng` behind the `random`/`uniform`/
  `normal`/`integer` that evaluated code calls, `uids` behind gum's own draws (clip and mask ids),
  separate so a clipped element never shifts the data. `with(settings)` derives an Env with other
  settings: registries copied (so `use` on either leaves the other alone), streams shared unless a
  `seed` is given.
- **Evaluation**: `scope(extra)` is what evaluated code sees — `env` itself, the bindings, the
  random functions on this Env's stream and the elements *bound to this Env* (`boundElems`: a
  `Proxy` per constructor that adds `env` to the args, so `<Circle />` and `new Circle()` in user
  code, and a user `class Foo extends Circle`, all land in the evaluating Env; `src/lib/parse.ts`
  binds the scope as the code's globals). `evaluate(code, args)` runs against `with({ theme,
  strict })` plus a fresh `rng` (seeded `seed ?? DEFAULT_SEED`, so evaluations are repeatable) and,
  only if seeded, fresh `uids` (otherwise ids keep advancing across evaluations, so several
  figures on one page never collide); `prelude(code, args)` returns a prelude's bindings.
  `evaluateGum`/`evaluatePrelude` (`src/eval.ts`) are the default Env's.
- **The default Env** (`src/lib/default.ts`): `defaultEnv()` (exported as `gum` from the entry)
  is created lazily through a factory `src/env.ts` installs, because the elements import
  `default.ts` for their fallback and `env.ts` imports the elements — nothing else may import
  `src/gum.ts` or `src/eval.ts` (the tops of the import graph) from below. `setDefaultEnv`
  replaces it. Host code that constructs elements without `env` gets it.

**How elements get their Env**: every element takes `env` in its args (`ElementArgs.env`) and
`Element.env` is a getter over its stored `args` (`resolveEnv(this.args.env)`, the default Env
when absent), which works because every element stores its outermost args after `super`, even
when it builds fresh args for `super`. What reads it: `THEME(args, elem)` (`src/lib/theme.ts`)
picks the theme layer from `args.env`; `strictError(env, kind, message)` / `isStrict(env)`
(`src/lib/strict.ts`); `textFont(family, weight, env)` and the other measurers in `src/lib/text.ts`
take `env` in their `TextSizerArgs`; `makeUID(prefix, env)` draws from `env.uids`. The rule for
element code: **every internal construction site passes `env`** — a constructor that needs it
destructures `env` alongside its other props, last before the rest (`const { foo, env, ...attr } = THEME(args, 'X')`;
THEME passes `args` through, so `env` comes out of it like anything else) and writes
`new Child({ ..., env })` and `super({ env, ... })` explicitly — once `env` is destructured it is
no longer in `...attr`, so every `super` must name it. Render-time code uses `env: this.env`, and
helpers that take no element get an `env` parameter. A constructor that never touches `env` can
leave it in `...attr`, where it flows to `super` on its own. A site that drops it silently falls back to the default Env (wrong theme, strict mode
or fonts); the `gum-jsx` suite walks every example tree in strict mode and fails on such a stray,
and its `test/env.ts` checks the leak and isolation semantics directly.

### Fonts

Text layout measures real glyph metrics with opentype.js, so the fonts must be loaded before elements are constructed. Each Env has a `FontRegistry` (`src/fonts/fonts.ts`, `env.fonts`): `paths` maps a family name to a file (or a light/regular/bold set) and `faces` gives the css face for names that are not their own family; `register`, `names`, `has`, `face`, `load`, `loaded`, `get` (the parsed font, for measurement) and `data` (the bytes). Every Env starts with the text fonts (IBM Plex Sans/Mono; `TEXT_FONT_PLUGIN`, `TEXT_FONTS`), a plugin adds its own (`@gum-jsx/math`: the 18 KaTeX faces, `MATH_FONTS`), and `env.registerFont(name, path, face?)` registers one family and loads it. Loaded files are cached **process-wide by path** (the bytes and the parsed `Font`), so Envs that share a family share one fetch and one parse, and re-registering a name under a new path simply reads the new file:

- **node**: nothing to do — registered fonts are read from disk on first use (`FontRegistry.get`), so a render only parses the faces it touches.
- **browser**: fonts are fetched, so hosts must `await env.loadFonts()` (everything registered), `loadTextFonts(env?)`, `env.loadFonts([...names])`, or `@gum-jsx/math`'s `loadMathFonts(env?)` (all 18 KaTeX faces, ~480 kB) / `loadBaseMathFonts(env?)` (the 7 ordinary math needs, ~190 kB) before evaluating. A missing font throws `FontNotLoadedError` (exported from `@gum-jsx/core` and `@gum-jsx/core/fonts`; `.font` is the family) from `textFont`, so a host can `env.loadFonts([e.font])` and retry — `@gum-jsx/math`'s `mathToSvgAsync` does exactly that. An unregistered family is a plain `Error` (`Unknown font family`).

The SVG output references fonts by family name (plus `font-weight`/`font-style` for the bold and italic KaTeX faces); a browser host also needs `@font-face` rules (the URLs are in `env.fonts.paths`) for the glyphs to actually draw. A face that is not its own family (the bold and italic KaTeX faces, registered one name per file for measurement) is emitted by `Span` as the base family plus weight/style via `env.fonts.face()`, which is how fontconfig (used by the rasterizer) and browsers know it. `@gum-jsx/node` hands an Env's registry to node-canvas at each rasterization (tracking what it has registered), so fonts registered after it is imported are still found.

### Component System

The library is built around a class hierarchy split across element modules:

**Element** (`src/elems/core.ts`) - Base class for all components
- Stores `args` (constructor arguments) as a dictionary for easy cloning; `env` (a getter over `args.env`) is the Env it was built against
- Has a `spec` object containing layout parameters (rect, coord, aspect, aspect0, expand, align, upright, offset, rotate, rotate_adjust, rotate_invar, and the protocol's width, height, share, fit)
- Has an `attr` object containing SVG attributes (stroke, fill, etc.)
- Takes `metrics` (what it states about its layout box, in its own em, the record of `src/lib/em.ts`; an element that measures fills in the rest, and a subtype's extra fields ride along unchanged) and `scale` (its em over its parent's), and keeps the scaled record as `em`; only content with a box has one, so `'em' in x` says whether it takes part in em layout. `Group` derives its `coord` and `aspect` from `metrics` through `em_frame` (`origin` puts y = 0 at the top of the box or at its anchor) unless they are given
- Every em record goes in through `set_em`, which also resolves what follows from it (the `scale` field): the constructor calls it, and so do the cheap clones that swap a record in place (`with_em`, a stack placing a child by the box it was laid to), so derived values never go stale and nothing reads them through a getter
- Renders to SVG via the `svg(ctx)` method that takes a Context object

`clone` keeps placement changes shallow: it copies `args`, `spec`, and `attr`,
while sharing children, measurements, and adapter metadata. Other changes call
`rebuild` with the merged constructor args. That method normally just invokes
the constructor; `with_em` installs a reconstruction hook on adapted elements
to reapply explicit metric patches over fresh measurements. Successive patches
merge into one record, and placement copies share it. Unpatched fields can
change with text, fonts, or wrapping width; patched numbers remain literal
overrides. A metric subtype can pass its normalizer as `with_em`'s fourth
argument to restore its defaults too (`with_math` uses `make_math`). Do not
deep-copy children or preserve an entire stale metric snapshot in `clone`.

**Group extends Element** (`src/elems/core.ts`) - Container base class
- Has a `children` array of Elements
- Supports automatic aspect ratio detection (`aspect: 'auto'`)
- Supports automatic coordinate system detection (`coord: 'auto'`)
- Handles clipping and masking

**Layout containers** (`src/elems/layout.ts`):
- `Box`, `Frame`, `TextBox`, `TextFrame` (`box.ts`: padding and margin in em), `Stack`, `VStack`, `HStack`, `HWrap`, `Grid`
- `Points`, `Anchor`, `Attach`, `Absolute`, `Field`, `Spacer`

### The layout protocol

Everything is laid out in **em**, the size of the text, by one engine, `src/lib/layout.ts`.
Every element answers two questions, both in its parent's em (an element with a `scale` lays
itself out in its own em and reports its box scaled):

- `bounds()` — the sizes it can come out at: a `[min, max]` range per axis (`max` may be
  `Infinity`) plus an `aspect` when its width follows from its height and back, as
  `w − ox = aspect · (h − oy)` with an `offset` (a shape's ray, shifted once padding or gaps
  surround it, so the relation survives composition). The classification a container needs
  falls out: *fixed* on an axis (`min == max`: a formula, text with a width), *tied*
  (`aspect`), *flexible* in height (`max == Infinity`: takes a budget), *growable* (flexible,
  no aspect: takes slack), *content* (finite max height: height follows from width).
- `lay(offer)` — laid out for `{ width?, height?, fill?, justify?, attr? }`: the element to
  place and its box (`Laid = { elem, em }`, the em record of `src/lib/em.ts` with its anchor
  and ink overhang).

`Element` implements both from what an element already declares: `spec.aspect` is a tied ray,
an `em` record a point (shrunk to a narrower slot, never grown), neither a stretch that fills
what it is offered (one side offered: a square). Subclasses override `natural()` and
`place(offer)`; the base applies a size of the element's own (`width`/`height` in its em,
reserved spec keys, pinning the bounds to a point and boxing the result in a `Group` when the
content is smaller), `share` (its fraction of a stack's length), and `fit` (an element with
metrics scaled to its slot like a figure: share-world text). `Text` is content: bounds from
its longest word to its one line, `place` wraps for the width (or the narrowest width that
fits an offered height); `Stack`, `TextBox`, `TextGrid` and `Bullets` rebuild themselves for
the offer (the internal `offer` arg). `Group`, `Box`, `Frame`, `Grid` and the plots are
shapes: children placed by rect are scaled into it, as ever (that is the share world, and it
needs no em).

**Stack** (`src/elems/layout.ts`) is the one stack: `VStack`/`HStack`, `TextStack`/`TextCol`/
`TextRow` (text defaults) and math's `MathRow`/`MathCol` are all `layout_em_stack` in
`src/elems/em.ts` over the engine. A column hands its width down, is as tall as its children
come to, and treats a height as a budget that only becomes its box when something can use it
(growables take what the figures leave; over budget every flexible child shrinks by one
factor: tied children narrow together to a common width, as a figure would be fit, growables
from their height at the width, none below its minimum). A row gives
fixed children their width, sizes tied children by its height (giving way toward their fair
share of the width until the content fits the height and the tied ones fit the width, a
bisection), and splits the rest
evenly with clamps (`distribute`, the flexbox loop); flexible children take their allocation
as their box (`fill`). `gap` is em, `spacing` a fraction of the length, `share` on a child a
fraction of the length (gross: half means half); a stack with no width of its own hugs its
children. `Svg` offers its lone child the canvas in em (`em`, or `width`/`height`; default
`D.svg_ems` across the larger side), then fits the box it comes back with to the pixel size,
so a figure fills it, a text column wraps to it, and a paragraph alone is as wide as its line.
`Box` (`src/elems/box.ts`; `Frame` is border 1, `TextBox`/`TextFrame` the same with a text
padding default, `TitleBox`/`TitleFrame`/`LabelBox` in `slide.ts`) is the one box: `padding`
and `margin` in em, exact bounds (`box_bounds` over the content's, an affine tie), one lay. Its
content is the children with no rect of their own (elements; `TextBox`/`TextFrame` set strings
as a `Text`, left-aligned by default) with the box's `font-*`/`text-*` settings handed down; offered a size it lays the first content child out for the area
inside the padding and hugs it (`Box.place` rebuilds with the `offer`), so wrapping a column
in a frame changes nothing inside it; nothing offered, the content is at its natural size (the
protocol's one-em convention for a figure). A box with an `aspect` is a figure of that shape
(fit to the offer in `place`, the content fit into the area by the context as any figure's
content is, text offered `fit` so it scales rather than wraps into a sliver; grown around the
content when nothing is offered), a `flex` one fills the offer. Children at a rect of their own
are decorations placed relative to the padded area, one with metrics placed by `pos` alone at
its own size (`is_unsized_em`: how `TitleBox` puts its title on the border); `clip` and `mask`
may be functions of the box geometry, in em (the title's cutout in the border). A rotated box
is placed as a figure by its rotated aspect. `Plot` keeps a fractional `margin` of its own
(`margin_rect`), its labels being share-world. Plain groups stay the share world: a child at a
rect gets no offer and is fit into the rect, so a stack placed by rect hugs its children at
their natural sizes.

**Geometry elements** (`src/elems/geometry.ts`):
- `Line`, `UnitLine`, `VLine`, `HLine`, `Square`, `Ellipse`, `Circle`, `Dot`, `Ray`
- `Polygon`, `Triangle`, `Path`, `Spline`, `Arc`, `RoundedRect`, `ArrowHead`, `Arrow`

**Text elements** (`src/elems/text.ts`):
- `Span`, `Text`, `Verbatim`, `TextStack`, `TextCol`, `TextRow`, `TextGrid`, `TextFigure`, `Bullets`, `Bold`, `Italic`

`Text` defaults to collapsed whitespace. `whitespace="pre"` or `"preserve"`
accepts plain strings, preserves spaces and explicit lines (including blank
lines), and expands tabs to `tab_size` columns (default 4). Literal lines are
measured as whole `Span` runs and placed at one common width, without wrapping.
`width` may widen that box but cannot make it narrower than the source.
`Verbatim` supplies monospace and preserved whitespace as defaults. `Span`
passes the whitespace policy to measurement and emits `xml:space="preserve"`.
A `Span` is framed as the 1em line it sits in by default (`frame: 'line'`, no
box of its own: a line places it by its advance) or by its ink (`frame: 'ink'`:
the glyph run's ink about the math axis is its coordinate frame and its layout
box, with `axis` putting the baseline a quarter em below the axis or centering
the ink on it); math's `MathSpan` is the ink frame plus atom classes.
JSX formatting-only whitespace is discarded at parse time; explicit string
expressions survive unchanged. `TextBox` lays a preserved text child out as a
block, rather than flattening it back into ordinary text spans.

**Plot elements** (`src/elems/plot.ts`):
- `Bar`, `Bars`, `Scale`, `Labels`, `Axis`, `Mesh`, `Graph`, `Plot`, `BarPlot`, `Legend`

**Network elements** (`src/elems/network.ts`):
- `ArrowSpline`, `Node`, `Edge`, `Network`

**Symbolic elements** (`src/elems/symbolic.ts`):
- `SymPoints`, `SymLine`, `SymSpline`, `SymPoly`, `SymFill`, `SymField`

**Slide elements** (`src/elems/slide.ts`):
- `TitleBox`, `TitleFrame`, `Slide`

### Context System

Rectangle rounding uses the same `Context.unit` as strokes: `rounded={10}`
means a radius of ten stroke units, regardless of box aspect or text size.
`Rect` resolves its scalar or x/y radii in `props(ctx)`; `RoundedRect` resolves
its per-corner offsets in `data(ctx)` after placement and reduces overlapping
corners proportionally. Text frames pass rounding through directly; their
padding and margin still use em. `DEFAULTS.rounded` is the shared boolean
rounding default. No separate drawing-length or em-context protocol is needed.

The `Context` class handles coordinate system mapping:
- Maps from logical coordinates (`coord`) to pixel coordinates (`prect`)
- Handles rotations, aspect ratios, alignments, and expansions
- Pre-computes scalers for performance
- Core method: `map(spec)` transforms child specs into new contexts
- Carries a **stroke unit** (`unit`, pixels per unit of `stroke_width`). The root `Svg` sets it
  from the rendered size (`max(w, h) / D.unit_size`, so `stroke_width = 1` is one pixel at a
  1000px render) and `map()` inherits it unchanged, so strokes scale with the image rather than
  staying a fixed pixel width. The reference size is the `unit_size` prop of `Svg` (default
  `D.unit_size`; `--unit-size` on the CLI): it is the size the image was designed at, so a
  32px icon sets `unit_size={32}` to get pixel strokes and still scales them when rendered
  larger. `Element.props()` resolves `stroke_width`, `stroke_dasharray` and
  `stroke_dashoffset` against it at emit time, and the root emits a scaled default `stroke-width`
  so implicit strokes scale too. The offset half of an `MNumber` is in the same unit, so
  `Arrow`'s half-a-stroke pullback keeps pace. A container may rebase `unit` to its own box
  (via `ctx.clone({ unit })`) so its strokes scale with its content rather than the image —
  math wants pixels per em. `stroke_width` itself stays a plain number; the scale lives in the
  context, which is what keeps arithmetic like `0.5 * stroke_width` valid.

### Coordinate Systems

Elements can specify positioning via:
- `rect`: logical rectangle `[x1, y1, x2, y2]`
- `coord`: internal coordinate system for children
- `pos` + `rad`: center position and radius (convenience)
- `xlim`/`ylim`: axis limits (convenience)

Key functions for rect manipulation:
- `rect_radial`, `radial_rect` - center/radius format conversion
- `rect_box`, `box_rect` - min/size format conversion
- `merge_rects`, `merge_points` - bounding box calculation
- `expand_rect`, `flip_rect` - transformations

### Evaluation Pipeline

1. **Parse** (`src/lib/parse.ts`): JSX code → JS using the Acorn parser
   - Rewrites only the JSX ranges of the source, to `__COMPONENT__(Tag, "Tag", line, props, ...children)`
     calls that span the same lines as the JSX they replace; the rest of the code runs verbatim, so
     line numbers in the running code are the source's
   - Handles JSX expressions, spreads, fragments and nested children; a program that is one bare
     element returns it
   - Runs the result as a `new Function` body under a `//# sourceURL`, with the Env's scope
     (`Env.scope`: the Env-bound components, constants, utilities and random functions) bound as
     the code's globals
   - Errors (`src/lib/errors.ts`): a parse failure is an `ErrorSyntax` with `line`/`column`; a
     throw while running is wrapped in an `ErrorRuntime` with the original as `cause`, its `kind`
     (the original name), the user code `frames` mapped back to source lines, the JSX `sites`
     being constructed (recorded as the error unwinds through `__COMPONENT__`), the element
     constructor `trail` from the stack, and `traceback()` for the text form. Both are exported
     from `@gum-jsx/core/env` and `@gum-jsx/core/eval`

2. **Evaluate** (`src/env.ts`, `Env.evaluate`; `src/eval.ts` for the default Env): AST → Element tree
   - Derives the Env for the call (theme, strict, a fresh seeded random stream) and runs the transformed code to instantiate components against it
   - Wraps result in `Svg` component if needed
   - Validates that result is an Element

3. **Render** (`src/elems/*.ts`): Element tree → SVG string
   - Each Element's `svg(ctx)` method renders itself
   - Context propagates coordinate transformations down the tree
   - Groups recursively render their children

4. **Rasterize** (`@gum-jsx/node`): SVG string → PNG buffer
   - Uses `node-canvas` to rasterize the SVG string to a PNG buffer
   - Can also format the output as a Kitty terminal image

### File Organization

**Top-level modules:**
- `src/env.ts` - `Env` (registries, settings, `use`/`with`/`scope`/`evaluate`/`prelude`), `corePlugin` (`CORE_ELEMS`, the constants and utilities), `bindConstructor`, the evaluation errors; installs the default Env's factory
- `src/gum.ts` - The package entry: re-exports all elements and utilities, the named constants (`none`, `blue`, `red`, etc.), `Env` and the default Env `gum`
- `src/eval.ts` - `evaluateGum`/`evaluatePrelude` against the default Env, `fitSize`
- `src/inspect.ts` - Inspecting a rendered `Svg`: `zoomSvg(elem, zoom)` rebuilds it with the viewBox cropped to a fractional region `[x0, y0, x1, y1]` and magnified to the original size box (`validateZoom` checks the region, `zoomRect` maps it to view coordinates); `layoutSvg(elem, { depth, select, zoom })` walks the tree the way `Group.inner` does (`ctx.map(child.spec)`) and lists each element's placed and allocated pixel boxes as text (`layoutRows` for the rows). Shared by the studio's snapshot/exec tools and the `gum` CLI's `--zoom`/`--format layout`

**Element modules (`src/elems/`):**
- `core.ts` - `Context`, `Element`, `Group`, `Svg`, `Rect`, plus `prefix_split`, `spec_split`, `align_frac`, `is_element`
- `box.ts` - `Box`, `Frame`, `TextBox`, `TextFrame`
- `layout.ts` - `Stack`, `VStack`, `HStack`, `HWrap`, `Grid`, `Points`, `Anchor`, `Attach`, `Absolute`, `Field`, `Spacer`
- `geometry.ts` - `Line`, `UnitLine`, `Square`, `Ellipse`, `Circle`, `Dot`, `Ray`, `Polygon`, `Triangle`, `Path`, `Spline`, `Arc`, `RoundedRect`, `ArrowHead`, `Arrow`
- `text.ts` - `Span`, `Text`, `Verbatim`, `TextStack`, `TextCol`, `TextRow`, `TextGrid`, `TextFigure`, `Bullets`, `Bold`, `Italic`
- `plot.ts` - `Bar`, `Bars`, `Scale`, `Labels`, `Axis`, `Mesh`, `Graph`, `Plot`, `BarPlot`, `Legend`
- `network.ts` - `ArrowSpline`, `Node`, `Edge`, `Network`
- `symbolic.ts` - `SymPoints`, `SymLine`, `SymSpline`, `SymPoly`, `SymFill`, `SymField`
- `image.ts` - `Image`
- `slide.ts` - `TitleBox`, `TitleFrame`, `Slide`

**Library modules (`src/lib/`):**
- `utils.ts` - Math utilities, array/vector ops, rect manipulation, color handling
- `text.ts` - Text measurement and wrapping using opentype.js
- `em.ts` - The em metrics record and its queries (bounds, ink, hull, the frame a group draws in, scaling)
- `layout.ts` - The layout engine: bounds, offers, the column and row algorithms, `distribute`
- `parse.ts` - JSX transform (Acorn, line preserving) and the code runner
- `errors.ts` - `ErrorSyntax`/`ErrorRuntime` with source positions, stack parsing
- `default.ts` - The default Env (a leaf module: `defaultEnv`, `resolveEnv`, `setDefaultEnv`)
- `theme.ts` - The theme layers and `THEME()`, which picks the layer from `args.env`
- `rng.ts` - The `RNG` class and the default Env's `random`/`uniform`/... for host code
- `strict.ts` - Strict mode: turns silent rendering fallbacks into thrown errors (`strictError(env, kind, message)`)

**Scripts:**

**Documentation:**

The docs and gallery live in `@gum-jsx/docs` (`../gum-jsx-docs`): `docs/text/` and `docs/code/`
(one page and one example per element), `gala/text/` and `gala/code/` (the gallery). Add or edit
a page there, not here.

## Important Patterns

### Component Creation

All components take a single `args` parameter (a dictionary) and store it:
```javascript
class MyComponent extends Element {
    constructor(args = {}) {
        const { myProp, ...attr } = args
        super({ tag: 'g', ...attr })   // `env` rides in attr here; once destructured, name it in super explicitly
        this.args = args
        this.myProp = myProp
    }
}
```

### Attribute Splitting

Use `spec_split(attr)` to separate layout params from SVG attributes:
```javascript
const [ spec, attr ] = spec_split(args)
// spec: { rect, coord, aspect, aspect0, expand, align, upright, offset, rotate, rotate_adjust, rotate_invar }
// attr: { stroke, fill, opacity, ... }
```

Use `prefix_split(prefixes, attr)` to split prefixed attributes for passing to sub-components. This allows parent components to accept prefixed props that get forwarded to children:
```javascript
class Plot extends Group {
    constructor(args = {}) {
        const { env, ...attr0 } = THEME(args, 'Plot')
        const [ xaxis_attr, yaxis_attr, attr ] = prefix_split(['xaxis', 'yaxis'], attr0)
        const xaxis = new Axis({ ...xaxis_attr, direc: 'h', env })   // children are built against the same Env
        const yaxis = new Axis({ ...yaxis_attr, direc: 'v', env })
        super({ children: [ xaxis, yaxis ], env, ...attr })
    }
}
```

### Context Mapping

Transform child specs through the context system. The `ctx.map(spec)` method takes a child's spec and returns a new Context with a pixel rect (`prect`) that conforms to the child's aspect ratio and alignment:

```javascript
inner(ctx) {
    return this.children
        .map(c => c.svg(ctx.map(c.spec)))
        .join('\n')
}
```

When mapping, if the child specifies an `aspect` ratio, `ctx.map()` will compute a pixel rect that respects that aspect. The child will be aligned within the available space according to its `align` parameter (e.g., 'center', 'left', [0.5, 0.5]).

## Element Specification

Element specification keys:
- `rect`: A rectangle `[x1, y1, x2, y2]` in coordinate space
- `coord`: The coordinate system for children `[xmin, ymin, xmax, ymax]`
- `aspect`: Width/height ratio
- `aspect0`: Original aspect ratio (before rotation, internal use only)
- `expand`: Whether to expand (true) or shrink (false) when fitting aspect
- `align`: How to align content ('left'/'center'/'right' or 'top'/'middle'/'bottom', or numeric 0-1)
- `rotate`: Rotation in degrees
- `rotate_invar`: Rotation-invariant (apply rotation after layout, not before)
- `rotate_adjust`: Adjust rotation to fit aspect ratio

Convenience keys (these map into the above keys):
- `flex`: Override to set `aspect = null`
- `pos/size`: Center position and size of the child's rectangle
- `xsize/ysize`: Specifies one dimension of `size` and applies `expand`
- `xlim/ylim`: Specify the coordinate limits for a specific dimension
- `spin`: Specifies a `rotate` value and applies `rotate_invar`
- `orient`: Specifies a `rotate` value and applies `rotate_adjust`
- `upright`: Whether to order the child's pixel rect (true) so a flipped parent coord (a `Graph`) places it but does not flip its insides; defaults to true for compound elements (`Box`, `Stack`, `Grid`, the text and math elements, `Arc`, `RoundedRect`) and false for point geometry, which should see the flip
- `offset`: Whether to offset the child by the parent's rect (true) or not (false)

## Math Elements

The LaTeX elements (`Latex`, `Tex`, `MathArray`, `MathStretch`, …) are in `@gum-jsx/math`; see
that package's `CLAUDE.md` for how the katex parse tree is converted. What core provides for
them: `Span` measurement (`raw_text_metrics`, `text_has_glyphs` in `src/lib/text.ts`), the stroke
unit on `Context` (a math shape rebases it to its box's pixels per em), the `Latex`/`MathShape`
theme entries in `src/lib/theme.ts`, and the strict-mode kinds in `src/lib/strict.ts`.
