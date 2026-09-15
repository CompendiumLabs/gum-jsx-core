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
    foreground: 'black', text: '#334155', muted: '#64748b',
    border: '#cbd5e1', grid: '#e2e8f0', accent: '#2563eb', area: '#dbeafe',
  }),
  dark: Object.freeze({
    foreground: 'white', text: '#e2e8f0', muted: '#94a3b8',
    border: '#475569', grid: '#334155', accent: '#60a5fa', area: '#1e3a5f',
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
