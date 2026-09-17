import { white, black, blue, lightgray, darkgray, gray } from '../lib/constants'

type ThemeName = 'light' | 'dark'
type ThemePalette = Readonly<{
  foreground: string
  text: string
  muted: string
  border: string
  grid: string
  accent: string
  area: string
}>

const THEMES: Readonly<Record<ThemeName, ThemePalette>> = Object.freeze({
  light: Object.freeze({
    foreground: black,
    text: black,
    border: black,
    muted: darkgray,
    grid: gray,
    accent: blue,
    area: blue,
  }),
  dark: Object.freeze({
    foreground: white,
    text: white,
    border: white,
    muted: lightgray,
    grid: gray,
    accent: blue,
    area: blue,
  }),
})

function resolve_theme(theme: ThemeName = 'light'): ThemeName {
  if (theme !== 'light' && theme !== 'dark') throw new TypeError('theme must be light or dark')
  return theme
}

// Semantic paint strings survive construction and resolve only during layout.
function theme_color(paint: string, theme: ThemeName): string {
  if (typeof paint !== 'string') throw new TypeError('Paints must be strings')
  if (!paint.startsWith('theme:')) return paint
  const key = paint.slice(6)
  if (!Object.hasOwn(THEMES[theme], key)) throw new TypeError(`Unknown theme color: ${paint}`)
  return THEMES[theme][key as keyof ThemePalette]
}

export { THEMES, resolve_theme, theme_color }
export type { ThemeName, ThemePalette }
