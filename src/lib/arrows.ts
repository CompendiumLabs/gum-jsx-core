import { finite, nonnegative } from './checks'
import { make_point } from '../engine/geometry'
import type { PathCommand } from '../engine/path'

type BarbCommand = Exclude<PathCommand, { kind: 'Q' | 'Z' }>

// One barb in tip-relative coordinates: x runs back along the shaft, y runs
// outward. Curve turns the tip tangent toward the shaft without moving either
// endpoint. Cubic pieces approximate a circular arc, at most a quarter turn each.
function arrow_barb(length: number, width = 0.65, curve = 0) {
  nonnegative(length, 'head_size'); nonnegative(width, 'head_width')
  finite(curve, 'curve')
  if (curve < 0 || curve > 1) throw new RangeError('curve must be between 0 and 1')
  const end = make_point(length, length * width / 2)
  const half = Math.atan(width / 2), bend = curve * half
  const commands: BarbCommand[] = [{ kind: 'M', x: 0, y: 0 }]
  if (!bend || !length) commands.push({ kind: 'L', ...end })
  else {
    const count = Math.ceil(2 * bend / (Math.PI / 2)), chord = Math.hypot(end.x, end.y)
    const sinc = (x: number) => x === 0 ? 1 : Math.sin(x) / x
    const on_arc = (t: number) => {
      if (t === 1) return end
      // This form stays stable as the curvature approaches zero.
      const distance = chord * t * sinc(t * bend) / sinc(bend), angle = half + (t - 1) * bend
      return make_point(distance * Math.cos(angle), distance * Math.sin(angle))
    }
    const handle = chord / count * sinc(bend / count) / sinc(bend)
      / (3 * Math.cos(bend / (2 * count)) ** 2)
    for (let i = 0; i < count; i++) {
      const a = on_arc(i / count), b = on_arc((i + 1) / count)
      const a0 = half + (2 * i / count - 1) * bend, a1 = a0 + 2 * bend / count
      commands.push({ kind: 'C', x1: a.x + handle * Math.cos(a0), y1: a.y + handle * Math.sin(a0),
        x2: b.x - handle * Math.cos(a1), y2: b.y - handle * Math.sin(a1), ...b })
    }
  }
  // Sample the same cubics used for drawing and shaft-clearance calculations.
  const at = (t: number) => {
    const value = Math.max(0, Math.min(1, finite(t, 't'))) * (commands.length - 1)
    const index = Math.min(commands.length - 2, Math.floor(value)), u = value - index, v = 1 - u
    const a = commands[index], b = commands[index + 1]
    return b.kind === 'C'
      ? make_point(v ** 3 * a.x + 3 * v ** 2 * u * b.x1 + 3 * v * u ** 2 * b.x2 + u ** 3 * b.x,
        v ** 3 * a.y + 3 * v ** 2 * u * b.y1 + 3 * v * u ** 2 * b.y2 + u ** 3 * b.y)
      : make_point(length * u, end.y * u)
  }
  // Find where a parallel shaft meets the barb. Its outward coordinate is
  // monotone even for wide heads whose ends curl back slightly.
  const reach = (across: number) => {
    nonnegative(across, 'across')
    if (across >= end.y) return length
    if (!bend) return 2 * across / width
    let lo = 0, hi = 1
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (at(mid).y < across) lo = mid
      else hi = mid
    }
    return at(hi).x
  }
  return { commands, at, reach }
}

export { arrow_barb }
