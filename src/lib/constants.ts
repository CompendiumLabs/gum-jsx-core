// Public values shared by direct imports and evaluated JSX.
const sans = 'IBM Plex Sans'
const mono = 'IBM Plex Mono'
const italic = 'italic'
const light = 300
const regular = 400
const bold = 700

// Preserve the original Gum palette; these are not CSS named colors.
const none = 'none'
const black = '#000000'
const white = '#ffffff'
const gray = '#f0f0f0'
const blue = '#1e88e5'
const red = '#ff0d57'
const green = '#4caf50'
const yellow = '#ffb300'
const purple = '#9c27b0'
const lightgray = '#f6f6f6'
const darkgray = '#888888'
const slate = '#1e252e'

const e = Math.E
const pi = Math.PI
const tau = 2 * pi
const phi = (1 + Math.sqrt(5)) / 2
const r2d = 180 / Math.PI
const d2r = Math.PI / 180

export {
  sans, mono, italic, light, regular, bold,
  none, black, white, gray, blue, red, green, yellow, purple, lightgray, darkgray, slate,
  e, pi, tau, phi, r2d, d2r,
}
