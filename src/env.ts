// the evaluation environment
//
// An Env is everything gum.jsx code runs against: the element constructors
// bound by tag name and the constants and utilities bound as globals (the
// registries), plus the settings elements read while they are constructed —
// the theme, strict mode, the random streams and the font registry. Elements
// carry the Env they were built with (`Element.env`, from `args.env`), so
// nothing about a render is process-global: two Envs with different themes or
// element sets can be used side by side, and an evaluation leaves no state
// behind.
//
// `new Env()` starts with core (the elements, constants, utilities and text
// fonts of this package); `use(plugin)` adds an add-on's elements, bindings
// and fonts (`@gum-jsx/math` exports one); `with(settings)` derives an Env
// with other settings; `evaluate(code)` runs gum.jsx code against it. The
// default Env (`gum`, from the package entry) is what host code that never
// mentions an Env gets.

import type { ParseConfig } from 'papaparse'

import { RNG, DEFAULT_SEED } from './lib/rng'
import { FontRegistry, TEXT_FONT_PLUGIN, type FontPath, type FontFace, type FontPlugin } from './fonts/fonts'
import { runJSX, runPrelude } from './lib/parse'
import { ErrorSyntax, ErrorRuntime } from './lib/errors'
import { parseTable } from './lib/table'
import { setDefaultEnvFactory } from './lib/default'
import { is_string, map_object } from './lib/utils'
import type { ThemeName, LoadFile } from './lib/types'

import { sans, mono, moji, cmoji, light, regular, bold, none, black, white, gray, blue, red, green, yellow, purple, lightgray, darkgray, slate, e, pi, phi, r2d, d2r } from './lib/const'
import { zip, reshape, split, concat, slice, sum, prod, mean, cumsum, norm, range, linspace, enumerate, repeat, meshgrid, lingrid, exp, log, log10, sin, cos, tan, abs, pow, sqrt, sign, floor, ceil, round, atan, atan2, minimum, maximum, min, max, clamp, rescale, normalize, sigmoid, logit, smoothstep, interp, palette, polar, polard, rounder, add2, sub2, mul2, div2, addn, subn, muln, divn, addc, subc, mulc, divc, conjc, normc, argc } from './lib/utils'
import { spline1d, spline2d } from './lib/interp'

import { Element, Group, Svg, Rectangle, Spacer, is_element, type SvgArgs } from './elems/core'
import { Box, Frame, Stack, VStack, HStack, HWrap, Grid, Points, Anchor, Attach, Absolute } from './elems/layout'
import { Line, UnitLine, VLine, HLine, CoordLine, Segments, Square, Ellipse, Arc, Circle, Dot, Ray, Polygon, Triangle, Fill, VFill, HFill, Path, Spline, RoundedRect, RoundedLine, ArrowHead, Arrow } from './elems/geometry'
import { Span, TextLine, Text, Verbatim, TextStack, TextCol, TextRow, TextGrid, TextFigure, TextBox, TextFrame, Bullets, Bold, Italic } from './elems/text'
import { Node, Edge, Network } from './elems/network'
import { SymPoints, SymLine, SymSpline, SymPoly, SymFill, Field, SymField } from './elems/symbolic'
import { Bar, VBar, HBar, Bars, VBars, HBars, Scale, VScale, HScale, Label, HLabel, VLabel, Labels, HLabels, VLabels, Axis, HAxis, VAxis, OuterLabel, Mesh, HMesh, VMesh, Mesh2D, Graph, Plot, BarPlot, Legend } from './elems/plot'
import { LabelBox, TitleBox, TitleFrame, Slide } from './elems/slide'
import { PngImage, SvgImage, type PngImageArgs } from './elems/image'

//
// types
//

type ElementConstructor = new (args: any) => Element

// names bound as globals of evaluated code
type Bindings = Record<string, any>

// what an add-on contributes: element constructors by tag name, other
// globals for evaluated code, and font families
interface EnvPlugin {
    elems?: Record<string, ElementConstructor>
    bindings?: Bindings
    fonts?: FontPlugin
}

// the per-Env settings
interface EnvSettings {
    theme?: ThemeName    // light or dark (default: light)
    strict?: boolean     // throw on rendering fallbacks instead of drawing them (default: false)
    seed?: number        // seed the random streams (default: DEFAULT_SEED for random/uniform/..., ids continue)
}

interface EnvArgs extends EnvSettings {
    plugins?: EnvPlugin[]   // add-ons to use
    core?: boolean          // start with the core elements, bindings and fonts (default: true)
}

type TableRow = Record<string, unknown>
type LoadTable = (path: string, args?: ParseConfig<TableRow>) => TableRow[]

interface EvaluateArgs extends EnvSettings, SvgArgs {
    bindings?: Bindings           // extra names to bind
    prelude?: string | Bindings   // code (or the bindings of code, see `prelude`) evaluated first
    debug?: boolean
    loadFile?: LoadFile           // how loadTable(path) and <LoadImage id={path} /> read files
}

interface PreludeArgs extends EnvSettings {
    bindings?: Bindings
    debug?: boolean
    loadFile?: LoadFile
}

//
// errors
//

class ErrorNoCode extends Error {
    constructor() {
        super('No code provided')
    }
}

class ErrorNoReturn extends Error {
    constructor() {
        super()
    }
}

class ErrorNoElement extends Error {
    value: any

    constructor(value: any) {
        super(`Non-element returned: ${JSON.stringify(value)}`)
        this.value = value
    }
}

class ErrorGenerate extends Error {
    constructor(message: string) {
        super(`Generation error: ${message}`)
    }
}

class ErrorRender extends Error {
    constructor(message: string) {
        super(`Render error: ${message}`)
    }
}

//
// the core plugin
//

const Rect = Rectangle

const CONST = {
    e, pi, phi, r2d, d2r, none, white, black, blue, red, green, yellow, purple, gray, lightgray, darkgray, slate, sans, mono, moji, cmoji, light, regular, bold,
}

const UTILS = {
    range, linspace, enumerate, repeat, meshgrid, lingrid, zip, reshape, split, concat, slice, sum, prod, mean, cumsum, min, max, minimum, maximum, norm, clamp, rescale, normalize, exp, log, log10, sin, cos, tan, abs, pow, sqrt, sign, floor, ceil, round, atan, atan2, sigmoid, logit, smoothstep, polar, polard, rounder, interp, palette, add2, sub2, mul2, div2, addn, subn, muln, divn, addc, subc, mulc, divc, conjc, normc, argc, spline1d, spline2d,
}

// the core elements by tag name
// declared with `satisfies` rather than an annotation so the element names stay
// literal types (`keyof typeof CORE_ELEMS`) for consumers such as @gum-jsx/react
const CORE_ELEMS = {
    Element, Group, Svg, Box, Frame, Stack, VStack, HStack, HWrap, Grid, Points, Anchor, Attach, Absolute, Spacer, Ray, Line, UnitLine, HLine, VLine, CoordLine, Segments, Rectangle, Rect, RoundedRect, RoundedLine, Square, Ellipse, Arc, Circle, Dot, Polygon, Path, Spline, Triangle, Fill, VFill, HFill, Arrow, Field, Span, TextLine, Text, Verbatim, TextStack, TextCol, TextRow, TextGrid, TextFigure, TextBox, TextFrame, Bullets, Bold, Italic, LabelBox, TitleBox, TitleFrame, ArrowHead, Node, Edge, Network, SymPoints, SymLine, SymSpline, SymPoly, SymFill, SymField, Bar, VBar, HBar, Bars, VBars, HBars, Scale, VScale, HScale, Label, HLabel, VLabel, Labels, HLabels, VLabels, Axis, HAxis, VAxis, OuterLabel, Mesh, HMesh, VMesh, Mesh2D, Graph, Plot, BarPlot, Legend, Slide, PngImage, SvgImage
} satisfies Record<string, ElementConstructor>

// what every Env starts with: the elements, the constants and utilities bound
// in evaluated code (the random functions are bound per Env in `scope`), and
// the text fonts
const corePlugin: EnvPlugin = {
    elems: CORE_ELEMS,
    bindings: { ...CONST, ...UTILS },
    fonts: TEXT_FONT_PLUGIN,
}

//
// element binding
//

// a constructor that builds against `env` unless the args name another, so
// `new Circle()` in evaluated code (and `<Circle />`, which compiles to it)
// lands in the Env the code runs in. A Proxy keeps the class identity
// (instanceof, static members, subclassing) intact.
function bindConstructor<C extends ElementConstructor>(ctor: C, env: Env): C {
    return new Proxy(ctor, {
        construct(target, [ args = {} ], newTarget) {
            const args1 = args.env == null ? { ...args, env } : args
            return Reflect.construct(target, [ args1 ], newTarget)
        }
    })
}

//
// file loaders
//

function uint8ArrayToDataUrl(data: Uint8Array): string {
    let binary = ''
    for (const byte of data) binary += String.fromCharCode(byte)
    const base64 = btoa(binary)
    return `data:image/png;base64,${base64}`
}

interface LoadImageArgs extends PngImageArgs {
    id?: string
}

// what a `loadFile` puts in scope: `loadTable(path)` and `<LoadImage id={path} />`
function makeLoaders(loadFile: LoadFile, env: Env): Bindings {
    // image loader class
    class LoadImage extends PngImage {
        constructor(args: LoadImageArgs = {}) {
            const { id, ...attr } = args

            // check for id
            if (id == null) throw new Error('LoadImage id is required')

            // load image
            const data = loadFile(id, 'bytes') as Uint8Array
            const dataUrl = uint8ArrayToDataUrl(data)

            // pass to PngImage
            super({ data: dataUrl, ...attr })
        }
    }

    return {
        LoadImage: bindConstructor(LoadImage, env),
        loadTable(path: string, args: ParseConfig<TableRow> = {}): TableRow[] {
            const text = loadFile(path)
            if (!is_string(text)) throw new TypeError(`loadTable("${path}") expected text`)
            return parseTable(text, args)
        }
    }
}

//
// the environment
//

class Env {
    // registries
    elems: Record<string, ElementConstructor>
    bindings: Bindings
    fonts: FontRegistry

    // settings
    theme: ThemeName
    strict: boolean
    rng: RNG    // backs random/uniform/normal/integer in evaluated code
    uids: RNG   // backs gum's own draws (clip and mask ids), so they never shift the data

    // the Env-bound element constructors, rebuilt after `use`
    private bound: Record<string, ElementConstructor> | null

    constructor(args: EnvArgs = {}) {
        const { theme = 'light', strict = false, seed, plugins = [], core = true } = args
        this.elems = {}
        this.bindings = {}
        this.fonts = new FontRegistry()
        this.bound = null
        this.theme = theme
        this.strict = strict
        this.rng = new RNG(seed ?? DEFAULT_SEED)
        this.uids = new RNG(seed ?? DEFAULT_SEED)
        if (core) this.use(corePlugin)
        this.use(...plugins)
    }

    //
    // registries
    //

    // add plugins: their elements, bindings and fonts
    use(...plugins: EnvPlugin[]): this {
        for (const { elems = {}, bindings = {}, fonts } of plugins) {
            Object.assign(this.elems, elems)
            Object.assign(this.bindings, bindings)
            if (fonts != null) this.fonts.register(fonts.paths, fonts.faces)
        }
        this.bound = null
        return this
    }

    // register element constructors by tag name
    registerElements(elems: Record<string, ElementConstructor>): this {
        return this.use({ elems })
    }

    // bind values (constants, functions) as globals of evaluated code
    registerBindings(bindings: Bindings): this {
        return this.use({ bindings })
    }

    // make font families known by name without loading them
    registerFonts(paths: Record<string, FontPath>, faces: Record<string, FontFace> = {}): this {
        return this.use({ fonts: { paths, faces } })
    }

    // register one family and load it right away
    async registerFont(name: string, path: FontPath, face?: FontFace): Promise<void> {
        this.registerFonts({ [name]: path }, face != null ? { [name]: face } : {})
        await this.loadFonts(name)
    }

    // load font families (default: everything registered); needed in the
    // browser before anything with text is constructed, a no-op in node
    loadFonts(names?: string | string[]): Promise<void> {
        return this.fonts.load(names)
    }

    // whether the given families (default: everything registered) are available for measurement
    fontsLoaded(names?: string | string[]): boolean {
        return this.fonts.loaded(names)
    }

    //
    // settings
    //

    // an Env with the same registries (copied, so `use` on either leaves the
    // other alone) and these settings; without a seed it shares this Env's
    // random streams
    with(settings: EnvSettings = {}): Env {
        const { theme = this.theme, strict = this.strict, seed } = settings
        const env = new Env({ theme, strict, seed, core: false })
        env.elems = { ...this.elems }
        env.bindings = { ...this.bindings }
        env.fonts = this.fonts.clone()
        if (seed == null) {
            env.rng = this.rng
            env.uids = this.uids
        }
        return env
    }

    //
    // evaluation
    //

    // the element constructors bound to this Env (see bindConstructor)
    boundElems(): Record<string, ElementConstructor> {
        this.bound ??= map_object(this.elems, (_name: string, ctor: ElementConstructor) => bindConstructor(ctor, this))
        return this.bound!
    }

    // everything in scope for evaluated code: the Env itself, the bindings,
    // the random functions on this Env's stream, the bound elements and any extras
    scope(extra: Bindings = {}): Bindings {
        const { rng } = this
        const random = {
            setSeed: (seed: number) => { rng.setSeed(seed) },
            random: () => rng.random(),
            uniform: (lo?: number, hi?: number) => rng.uniform(lo, hi),
            normal: (mean?: number, stdv?: number) => rng.normal(mean, stdv),
            integer: (lo: number, hi?: number) => rng.integer(lo, hi),
        }
        return { env: this, ...this.bindings, ...random, ...this.boundElems(), ...extra }
    }

    // the Env one evaluation runs against: these settings, a fresh user random
    // stream (repeatable) and, only if seeded, fresh ids
    private forEvaluation({ theme, strict, seed }: EnvSettings): Env {
        const env = this.with({ theme, strict })
        env.rng = new RNG(seed ?? DEFAULT_SEED)
        if (seed != null) env.uids = new RNG(seed)
        return env
    }

    // the scope of one evaluation
    private evalScope(env: Env, bindings: Bindings, loadFile?: LoadFile): Bindings {
        const loaders = loadFile == null ? {} : makeLoaders(loadFile, env)
        return env.scope({ ...loaders, ...bindings })
    }

    // evaluate shared code (a prelude of declarations) and return its top-level
    // bindings, which can be passed as `bindings` or `prelude` to `evaluate` so
    // that several pieces of code share definitions
    prelude(code: string, args: PreludeArgs = {}): Bindings {
        const { theme, strict, seed, bindings = {}, debug = false, loadFile } = args
        const env = this.forEvaluation({ theme, strict, seed })
        const scope = this.evalScope(env, bindings, loadFile)
        return runPrelude(code, scope, debug)
    }

    // evaluate gum.jsx code to its root Svg element (`.svg()` serializes it)
    evaluate(code: string, args: EvaluateArgs = {}): Svg {
        const { theme, strict, seed, bindings = {}, prelude, debug = false, loadFile, ...svgArgs } = args

        // check if code is provided
        if (code == null || code.trim() == '') {
            throw new ErrorNoCode()
        }

        // the evaluation scope, with prelude bindings layered on top
        const env = this.forEvaluation({ theme, strict, seed })
        const scope0 = this.evalScope(env, bindings, loadFile)
        const preludeScope = prelude == null ? {} : is_string(prelude) ? runPrelude(prelude, scope0, debug) : prelude
        const scope = { ...scope0, ...preludeScope }

        // run the code and wrap the result
        const result = runJSX(code, scope, debug)
        return env.wrapSvg(result, svgArgs)
    }

    // the root Svg for what code evaluated to
    wrapSvg(result: any, args: SvgArgs = {}): Svg {
        // handle array result (from JSX fragments)
        if (Array.isArray(result) && result.every(is_element)) {
            return new Svg({ children: result, ...args, env: this })
        }

        // check if its actually a tree
        if (!is_element(result)) {
            if (result == null) {
                throw new ErrorNoReturn()
            } else {
                throw new ErrorNoElement(result)
            }
        }

        // wrap it in Svg if not already
        if (!(result instanceof Svg)) {
            return new Svg({ children: [ result ], ...args, env: this })
        }

        // return result
        return result
    }
}

// the default Env is created on first use (see lib/default.ts)
setDefaultEnvFactory(() => new Env())

//
// exports
//

export { Env, corePlugin, CORE_ELEMS, bindConstructor, ErrorNoCode, ErrorNoReturn, ErrorNoElement, ErrorGenerate, ErrorRender, ErrorSyntax, ErrorRuntime }
export { defaultEnv, setDefaultEnv, resolveEnv } from './lib/default'
export type { ElementConstructor, Bindings, EnvPlugin, EnvSettings, EnvArgs, EvaluateArgs, PreludeArgs, TableRow, LoadTable }
