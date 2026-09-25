# @gum-jsx/core

Gum's JSX evaluator, layout engine, and SVG renderer. It includes shapes, measured
text, boxes and stacks, plots, network diagrams, and reusable element components.
Elements describe a figure; layout produces immutable pixel fragments; rendering
serializes those fragments to SVG.

See the [Gum project](https://github.com/CompendiumLabs/gum-jsx#readme) for
getting started, command-line rendering, and the package overview.

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
`render_element` wraps a bare element in `Svg`, lays it out, and returns SVG,
size, fragment, and layout pass. Sources returning ordinary JavaScript values
produce a `{ kind: 'value', value }` result instead.

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

Emoji are measured with a bundled fallback face and emitted as live SVG text.
Their appearance depends on the display host's emoji font; PDF export currently
rejects live color-font text. Ordinary outlined text needs no viewer-side fonts.

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
The [source map and contributor notes](./API.md#contributor-notes) describe where
to make changes. Runnable examples live in `@gum-jsx/docs`.
