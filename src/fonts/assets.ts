/// <reference path="./assets.d.ts" />
import SansLight from './IBMPlexSans-Light.ttf'
import SansRegular from './IBMPlexSans-Regular.ttf'
import SansBold from './IBMPlexSans-Bold.ttf'
import MonoLight from './IBMPlexMono-Light.ttf'
import MonoRegular from './IBMPlexMono-Regular.ttf'
import MonoBold from './IBMPlexMono-Bold.ttf'
import EmojiMetrics from './NotoColorEmoji-Metrics.ttf'

// Static imports let bundlers include fonts in browser builds and executables.
const font_paths = { SansLight, SansRegular, SansBold, MonoLight, MonoRegular, MonoBold, EmojiMetrics }

function bundled_font(name: keyof typeof font_paths): URL {
  const path = font_paths[name]
  // Bun returns filesystem paths; browser bundlers return asset URLs.
  const drive = /^([A-Za-z]):[\\/]/.exec(path)
  if (!drive) return new URL(path, import.meta.url)
  const segments = path.slice(3).split(/[\\/]/).map(encodeURIComponent).join('/')
  return new URL(`file:///${drive[1]}:/${segments}`)
}

export { bundled_font }
