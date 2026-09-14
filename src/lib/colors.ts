import { finite } from './checks'
import { clamp, lerp, rescale } from './math'
import type { Limit } from '../engine/coordinates'

type RGBA = readonly [red: number, green: number, blue: number, alpha: number]

function hex_rgba(color: string): RGBA {
  if (!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)) {
    throw new TypeError('color interpolation needs #rgb, #rgba, #rrggbb, or #rrggbbaa')
  }
  let hex = color.slice(1)
  if (hex.length <= 4) hex = [...hex].map(char => char + char).join('')
  return Object.freeze([parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16), hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1])
}
function interpolate(a: RGBA, b: RGBA, t: number): string {
  finite(t, 'color interpolation fraction')
  const u = clamp(t), values = a.map((value, i) => lerp(value, b[i], u))
  return `rgba(${Math.round(values[0])}, ${Math.round(values[1])}, ${Math.round(values[2])}, ${values[3]})`
}
function interp(start: string, end: string, t: number): string {
  return interpolate(hex_rgba(start), hex_rgba(end), t)
}
function palette(start: string, end: string, lim: Limit = [0, 1]): (value: number) => string {
  const a = hex_rgba(start), b = hex_rgba(end), limits = Object.freeze([...lim]) as Limit
  rescale(limits[0], limits)
  return value => interpolate(a, b, rescale(value, limits))
}

export { interp, palette }
