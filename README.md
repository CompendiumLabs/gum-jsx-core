# @gum-jsx/core

The core of [gum.jsx](https://github.com/CompendiumLabs/gum-jsx): the evaluator that turns gum's JSX dialect into SVG, the element library behind it (layout, geometry, text, plots, networks, symbolic curves), and the fonts (IBM Plex) it measures text with. A pure, platform-neutral library with no CLI and no node-only dependencies — it runs the same in a browser and on a server. The batteries-included [`gum-jsx`](https://github.com/CompendiumLabs/gum-jsx) package wraps it together with the add-ons and ships the `gum` command; install that instead if you want the whole stack.

## Installation

```bash
npm install @gum-jsx/core
```

## Usage

`evaluateGum` evaluates a string of gum.jsx and returns the root `Svg` element; `.svg()` serializes it:

```javascript
import { evaluateGum } from '@gum-jsx/core/eval'

const jsx = `
<Plot xlim={[0, 2*pi]} ylim={[-1.5, 1.5]} grid margin={[0.2, 0.1]} aspect={2}>
  <SymLine fy={sin} stroke={blue} stroke-width={2} />
</Plot>
`
const elem = evaluateGum(jsx, { size: 800, theme: 'light' })
const svg = elem.svg()
```

The code runs with every element, constant (`pi`, `blue`, `sans`, …) and utility (`linspace`, `zip`, `random`, …) in scope, so most files are a single JSX expression; a file can also declare things and `return` an element. Options: `size` (a number or `[width, height]`), `theme` (`light` or `dark`), `bindings` (extra names to bind), `prelude` (code or the bindings of code evaluated first, see `evaluatePrelude`), `seed` (for `random`/`uniform`/`normal`/`integer`), `strict` (throw on rendering fallbacks instead of drawing them), `em_size` (the document's text size in pixels per em; by default the canvas is 20 lines tall), `loadFile` (how `loadTable(path)` and `<LoadImage id={path} />` in the code read files), `debug`, plus any `Svg` argument such as `padding`, `unit_size` or `bare`.

`evaluateGum` is the default **Env**'s `evaluate`. An `Env` is everything code evaluates against — the elements and names in scope, the fonts, the theme, strict mode and the random streams — and every element carries the Env it was built with, so nothing about a render is global: a dark evaluation leaves no dark theme behind, and two Envs with different settings or element sets can be used side by side. The default Env is `gum`; make your own for other defaults or an isolated element set:

```javascript
import { gum, Env } from '@gum-jsx/core'
import { math } from '@gum-jsx/math'

gum.use(math)                                   // <Latex> in the default Env (what gum-jsx does for you)
const dark = new Env({ theme: 'dark' }).use(math)
const elem = dark.evaluate(jsx, { size: 800 })  // or gum.with({ theme: 'dark' }).evaluate(...)
```

`new Env({ theme, strict, seed, em_size, plugins })` starts with core's elements, names and text fonts; `use(plugin)` adds an add-on's (a plugin is `{ elems, bindings, fonts }`, and `registerElements`/`registerBindings`/`registerFonts` add one kind); `with(settings)` derives an Env with other settings (its registries are copied, so `use` on either leaves the other alone); `evaluate` and `prelude` run code. The evaluation scope also binds `env` itself.

The elements are plain classes and can be used from JavaScript directly, with props in `snake_case`; an element built this way uses the default Env unless it is given one (`new Plot({ env, ... })`):

```javascript
import { Plot, SymLine, pi, sin, blue } from '@gum-jsx/core'

const elem = new Plot({
  children: [ new SymLine({ fy: sin, stroke: blue, stroke_width: 2 }) ],
  xlim: [0, 2*pi], ylim: [-1.5, 1.5], grid: true, margin: [0.2, 0.1], aspect: 2,
})
const svg = elem.svg()
```

The [documentation](https://compendiumlabs.ai/gum/docs) has a page and an example per element; the same pages ship in `@gum-jsx/docs`.

## Fonts

Text is measured against real font metrics, so the faces have to be loaded before anything with text is rendered. In node they are read from disk on first use and nothing more is needed. In a browser, fetch them first — `await loadTextFonts()` for IBM Plex (the faces every Env starts with), or `await gum.loadFonts()` for everything the Env knows, including a plugin's — otherwise rendering throws `FontNotLoadedError`. Each Env has a font registry (`env.fonts`, a `FontRegistry`: `register`, `names`, `face`, `load`, `loaded`, `get`, `data`); `env.registerFont(name, path, face)` adds a face of your own and loads it, and `env.fonts.data(name)` holds the fetched bytes for handing to `FontFace` so the page can draw the same glyphs the layout measured. Loaded files are cached process-wide by path, so Envs sharing a family share one copy. Emoji are measured with a fixed advance and left to the host's emoji font.

## Extending

An add-on is a plugin: an object `{ elems, bindings, fonts }` (`EnvPlugin`) that an Env applies with `use`, so a host that never uses it gets only core's names, and importing the add-on does nothing on its own; `@gum-jsx/math` exports `math` this way for `<Latex>` and the KaTeX faces. An add-on's elements subclass core's and take `env` in their args like every element (see `Element.env`), so they read the theme, strict mode and fonts of the Env they are built in. Internals are reachable through the subpath exports `@gum-jsx/core/env` (`Env`, `defaultEnv`, `resolveEnv`), `@gum-jsx/core/lib/*` (`Context`, `types`, `theme`, `strict`, `utils`, …), `@gum-jsx/core/elems/*` (the element modules), and `@gum-jsx/core/fonts` (the font registry) — that is the surface add-ons are written against.

Strict mode (`strict: true` on an Env or an evaluation) turns the permissive fallbacks — unparseable input, unknown tags or commands, glyphs missing from a face — into thrown `StrictError`s, which is how the `gum-jsx` test suite renders every example.
