# @gum-jsx/core

[Gum](https://github.com/CompendiumLabs/gum-jsx) — installation, quickstart, and user documentation.

Gum's JSX evaluator, layout engine, and SVG renderer. It includes shapes, measured
text, boxes and stacks, plots, network diagrams, and reusable element components.
Elements describe a figure; layout produces immutable pixel fragments; rendering
serializes those fragments to SVG.

## JSX to SVG

```ts
import { evaluate, render_element } from '@gum-jsx/core'

const source = `
  <Frame padding={em(1)} border-radius={px(8)}>
    <HStack gap={em(0.75)} align="center">
      <Circle width={px(32)} fill={blue} stroke={none} />
      <Text>Hello, Gum</Text>
    </HStack>
  </Frame>
`
const result = render_element(evaluate(source, { name: 'hello.jsx' }))
if (result.kind === 'svg') {
  await Bun.write('hello.svg', result.svg)
}
```

`evaluate` supplies the core elements, units, palette, and numeric helpers.
`render_element` wraps a bare element in `Page`, lays it out, and returns SVG,
size, fragment, and layout pass. Sources returning ordinary JavaScript values
produce a `{ kind: 'value', value }` result instead.

`Page` is the format-independent output boundary, replacing `Svg`. For multiple
pages, use `Document` with explicit Page children, shared page defaults, and an
optional title. `layout_document` (or `layout_element`) returns
`{ kind: 'document', pages, title, pass }`, where `pages` contains independently
laid-out fragments ready for PDF or PPTX export. `render_element` instead returns
an SVG result for each page. See the [Document reference](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/elements/text/Document.md).

Evaluation executes JavaScript in the host environment. Use trusted source or
provide a separate isolation boundary in your application.

## Reusable evaluators

Configure an `Evaluator` once to include package exports, custom components, or
shared data in every evaluation:

```ts
import { Evaluator } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'

const evaluator = new Evaluator({ scope: math, seed: 7 })
const formula = evaluator.evaluate('<Latex>{expression}</Latex>', {
  name: 'formula.jsx',
  scope: { expression: 'a+b=c' },
})
```

Core bindings are always included. Per-call scope overrides the evaluator's
bindings, which override core bindings. The constructor copies the binding map;
objects and functions in it retain their identities. Each call starts fresh
locals and a random stream using the configured seed (42 by default).
`name` and `seed` can also be overridden per call.

`evaluator.evaluate_prelude(code)` uses the same environment and returns declared
bindings for explicit reuse through a later call's `scope`. It does not add them
to the evaluator. The standalone `evaluate` and `evaluate_prelude` functions
remain available with core bindings and per-call options. Font loading and layout
are configured separately from evaluation.

## Direct construction and layout

JSX is optional. Element exports are constructors with the same props:

```ts
import { Frame, Text, em, layout_element, render_svg } from '@gum-jsx/core'

const element = new Frame({
  padding: em(1),
  children: new Text({ children: 'Hello, Gum' }),
})
const { fragment, pass } = layout_element(element)
const svg = render_svg(fragment, { title: 'Hello', id_prefix: 'hello' })
console.log(pass.stats)
```

Use `px()` for pixels, `em()` for font-relative lengths, and raw fractions for
relative lengths. Bare `24` means a fraction, not 24 pixels. Layout supports
natural measurements, available-space offers, and exact pixel allocations.
Reuse an element and `LayoutPass` to retain cached work across renders.

The core has no dependency on the math or output packages. TeX comes from
[@gum-jsx/math](https://github.com/CompendiumLabs/gum-jsx-math#readme); PNG and PDF
exporters consume SVG and fragments respectively.

## Fonts and browser hosts

Text uses bundled IBM Plex Sans and Mono faces and is normally emitted as glyph
paths. Bun loads font files on demand. In a browser, serve the bundled font
assets, call `await fonts.load()` on a `Fonts` instance, and pass it to
`render_element(element, { fonts })` before rendering text. See the
[fonts guide](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/docs/guides/text/fonts.md) for resource setup.

Use `render_element(element, { fonts, text_mode: 'live' })` to keep text and math
glyphs as positioned SVG text. Use `text_mode: 'mixed'` for live prose with
outlined math. The default is `text_mode: 'path'`. All three modes use the same
measurements, wrapping, baselines, and ink bounds.
The option also works on `layout_element`, before calling `render_svg`.
Changing modes invalidates a reused pass's layout cache.

Live text requires the same fonts in the display host. `fonts.font_sources()`
returns face family, weight, style, and a URL or byte snapshot for browser
`FontFace` registration; add the faces to `document.fonts` and await their loading
before displaying the SVG. The metrics-only emoji face is excluded. Fontkit's
`fonts.load()` loads measurement data and does not register browser fonts.
Custom providers can expose `MeasuredFont.face` to support live text; providers
without that metadata keep their outlines. Browser shaping and antialiasing can
differ from outlined output even with the same fonts.

Emoji are measured with a bundled fallback face and emitted as live SVG text.
Their appearance depends on the display host's emoji font; PDF export currently
rejects live color-font text. Ordinary outlined text needs no viewer-side fonts.

## Immutability and production performance

Gum snapshots caller-owned source data and exposes readonly elements, geometry,
and fragments. Runtime freezing is enabled by default in development and tests,
and disabled when `NODE_ENV=production`. Set `GUM_FREEZE=1` to force enforcement
or `GUM_FREEZE=0` to disable it, before importing Gum or starting the CLI:

```sh
NODE_ENV=production bun render.ts
GUM_FREEZE=0 bun run perf
GUM_FREEZE=1 bun run test
```

The setting is read once. Copying, validation, and cache behavior are the same in
both modes; consumers must always treat returned values as readonly. With
freezing disabled, mutating shared results can invalidate cached layout data.

For browser bundles, define `__GUM_FREEZE__` as the boolean `false` for production
or `true` for development. This build setting overrides the process environment.
Browsers without an explicit setting or process environment default to freezing.
Gum Studio and the MCP viewer builds configure this flag automatically and honor
`GUM_FREEZE` when building.

`FREEZE_ENABLED` exposes the selected policy. Custom elements can use
`freeze_owned(value)` after constructing or copying a value they own. It retains
`Object.freeze`'s readonly return types and shallow behavior, and returns the
same object in either mode. See the [API details](API.md#immutability-policy).

## Reference

The [core API reference](./API.md) covers units, sizing, layout contracts,
fragments, elements, fonts, plotting, networks, rendering, and contributor notes.
For authoring examples, start with the
[guides and gallery](https://github.com/CompendiumLabs/gum-jsx-docs/blob/master/README.md).

## Development

From this package directory:

```sh
bun run test
bun run typecheck
bun run probe
bun run probe hugging_box
```

Runtime code lives in `src/`; tests and tools live in `test/` and `scripts/`.

Run `bun run perf` for construction, layout, text, plots, JSX, and SVG benchmarks.
Use `--list`, `--filter <regex>`, `--smoke`, or `--json` to narrow or save a run.
See [performance workloads and methodology](test/perf/README.md).
The [source map and contributor notes](./API.md#contributor-notes) describe where
to make changes. Runnable examples live in `@gum-jsx/docs`.
