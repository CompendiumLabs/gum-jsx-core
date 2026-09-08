// themes

import { DEFAULTS as D, none, black, white } from './const'
import { map_object } from './utils'
import type { ThemeName } from './types'
import { resolveEnv } from './default'
import type { Env } from '../env'

//
// base layer
//

type ThemeAttrs = Record<string, any>
type ThemeLayer = Record<string, ThemeAttrs>

const BOOLEANS: ThemeLayer = {
    Box: {
        border: 1,
        padding: 0.5,
        margin: 0.5,
        rounded: D.rounded,
    },

    TextBox: {
        border: 1,
        padding: 0.5,
        margin: 0.5,
        rounded: D.rounded,
    },

    TextFrame: {
        border: 1,
        padding: 0.25,
        margin: 0.25,
        rounded: D.rounded,
    },

    Stack: {
        spacing: 0.1,
    },

    HWrap: {
        hgap: 0.5,
        vgap: 0.5,
    },

    Grid: {
        spacing: 0.1,
    },

    Rect: {
        rounded: D.rounded,
    },

    RoundedRect: {
        rounded: D.rounded,
    },

    Graph: {
        padding: 0.1,
    },

    Plot: {
        margin: 0.2,
    },
}

//
// theme definitions
//

const THEME_LIGHT: ThemeLayer = {
    TextBox: {
        padding: 0.5,
    },

    TextFrame: {
        padding: 0.5,
    },

    Svg: {
        fill: none,
        stroke: black,
    },

    Span: {
        color: black,
    },

    Plot: {
        grid_stroke: '#ddd',
    },
}

const THEME_DARK: ThemeLayer = {
    TextBox: {
        padding: 0.5,
    },

    TextFrame: {
        padding: 0.5,
    },

    Svg: {
        fill: none,
        stroke: white,
    },

    Dot: {
        color: white,
    },

    Span: {
        color: white,
    },

    Latex: {
        color: white,
    },

    MathShape: {
        fill: white,
    },

    Plot: {
        grid_stroke: '#555',
    },

    Legend: {
        fill: '#333',
    },

    Sqrt: {
        color: white,
    },
}

const THEMES: Record<ThemeName, ThemeLayer> = {
    light: THEME_LIGHT,
    dark: THEME_DARK,
}

//
// theme lookup
//

// the theme layer is selected by the Env the element is constructed against
// (args.env, else the default Env)
function THEME<T extends object>(args: T, elem: string): T {
    // get element defaults
    const { env } = args as { env?: Env }
    const BOOLEANS_ELEMENT = BOOLEANS[elem] ?? {}
    const DEFAULTS_ELEMENT = THEMES[resolveEnv(env).theme][elem] ?? {}

    // map in booleans from args
    const ARGS_MAPPED = map_object(args, (k: string, v: any) => (v === true) && (k in BOOLEANS_ELEMENT) ? BOOLEANS_ELEMENT[k] : v)

    // return the whole shazam
    return { ...DEFAULTS_ELEMENT, ...ARGS_MAPPED } as T
}

//
// exports
//

export { THEME, THEMES }
export type { ThemeName }
