import { make_point, make_rect } from './geometry'
import type { Point, Rect, Transform } from './geometry'
import type { Length } from './units'
import { finite } from '../lib/checks'

// Source commands use lengths; drawing commands use resolved pixels.
type PathCommand<T = number> = Readonly<
  | { kind: 'M' | 'L'; x: T; y: T }
  | { kind: 'Q'; x1: T; y1: T; x: T; y: T }
  | { kind: 'C'; x1: T; y1: T; x2: T; y2: T; x: T; y: T }
  | { kind: 'Z' }
>
type PathSegment = PathCommand<Length>

// Only paths validated here can bypass another ownership copy. A caller's
// frozen array may still contain mutable commands or invalid coordinates.
const owned_paths = new WeakSet<readonly PathCommand[]>()

// Absolute commands keep units explicit without introducing a second path parser.
function move_to(x: Length, y: Length): PathSegment {
  return Object.freeze({ kind: 'M', x, y })
}
function line_to(x: Length, y: Length): PathSegment {
  return Object.freeze({ kind: 'L', x, y })
}
function quad_to(x1: Length, y1: Length, x: Length, y: Length): PathSegment {
  return Object.freeze({ kind: 'Q', x1, y1, x, y })
}
function curve_to(
  x1: Length, y1: Length, x2: Length, y2: Length, x: Length, y: Length,
): PathSegment {
  return Object.freeze({ kind: 'C', x1, y1, x2, y2, x, y })
}
function close_path(): PathSegment {
  return Object.freeze({ kind: 'Z' })
}

// Resolve or transform every endpoint and control point through one mapping.
function map_path<T>(
  commands: readonly PathCommand<T>[], point: (x: T, y: T) => Point,
): readonly PathCommand[] {
  if (commands.length && commands[0].kind !== 'M') {
    throw new TypeError('A path must begin with move_to')
  }
  return Object.freeze(commands.map(command => {
    const { kind } = command
    switch (kind) {
      case 'Z': return Object.freeze({ kind })
      case 'M': case 'L': return Object.freeze({ kind, ...point(command.x, command.y) })
      case 'Q': {
        const { x: x1, y: y1 } = point(command.x1, command.y1)
        return Object.freeze({ kind, x1, y1, ...point(command.x, command.y) })
      }
      case 'C': {
        const { x: x1, y: y1 } = point(command.x1, command.y1)
        const { x: x2, y: y2 } = point(command.x2, command.y2)
        return Object.freeze({ kind, x1, y1, x2, y2, ...point(command.x, command.y) })
      }
      default: throw new TypeError(`Unknown path command: ${kind}`)
    }
  }))
}

// Copying validates all coordinates without retaining a caller's mutable records.
function copy_path(commands: readonly PathCommand[]): readonly PathCommand[] {
  if (owned_paths.has(commands)) return commands
  const path = map_path(commands, make_point)
  owned_paths.add(path)
  return path
}

function transform_path(
  commands: readonly PathCommand[], transform: Transform,
): readonly PathCommand[] {
  const [a, b, c, d, e, f] = transform
  const path = map_path(commands, (x, y) => make_point(a * x + c * y + e, b * x + d * y + f))
  owned_paths.add(path)
  return path
}

// Bezier curves stay inside their control hull. This deliberately conservative
// bound needs no curve solving; fonts can supply their more precise measured ink.
function path_bounds(commands: readonly PathCommand[]): Rect | null {
  if (!commands.some(command => ['L', 'Q', 'C'].includes(command.kind))) return null
  if (commands[0].kind !== 'M') throw new TypeError('A path must begin with move_to')
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  const point = (x: number, y: number) => {
    finite(x, 'x'); finite(y, 'y')
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  for (const command of commands) {
    switch (command.kind) {
      case 'Z': break
      case 'M': case 'L': point(command.x, command.y); break
      case 'Q': point(command.x1, command.y1); point(command.x, command.y); break
      case 'C':
        point(command.x1, command.y1); point(command.x2, command.y2); point(command.x, command.y)
        break
      default: throw new TypeError(`Unknown path command: ${(command as PathCommand).kind}`)
    }
  }
  return make_rect(left, top, right - left, bottom - top)
}

// Preserve pixel precision: rounding here can change glyphs or small geometry.
function path_data(commands: readonly PathCommand[], number: (value: number) => string = String): string {
  return commands.map(command => {
    switch (command.kind) {
      case 'M': case 'L': return `${command.kind}${number(command.x)} ${number(command.y)}`
      case 'Q': return `Q${number(command.x1)} ${number(command.y1)} ${number(command.x)} ${number(command.y)}`
      case 'C': return `C${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)}`
        + ` ${number(command.x)} ${number(command.y)}`
      case 'Z': return 'Z'
    }
  }).join('')
}

export { move_to, line_to, quad_to, curve_to, close_path, map_path,
  copy_path, transform_path, path_bounds, path_data }
export type { PathCommand, PathSegment }
