import { finite, nonnegative } from '../lib/checks'
import { make_point, make_rect, read_point } from './geometry'
import type { Point, PointValue, Rect as PixelRect } from './geometry'
import { copy_path, path_bounds } from './path'
import type { PathCommand } from './path'
import type { LineCap, LineJoin } from './style'

type Paint = Readonly<{
  fill: string
  stroke: string
  stroke_width: number
  stroke_linecap?: LineCap
  stroke_linejoin?: LineJoin
  stroke_miterlimit?: number
  stroke_dasharray?: readonly number[]
  opacity?: number
}>
type RectDraw = Readonly<{ kind: 'rect'; rect: PixelRect; radius?: Point } & Paint>
type EllipseDraw = Readonly<{ kind: 'ellipse'; center: Point; radius: Point } & Paint>
type PathDraw = Readonly<{
  kind: 'path'; commands: readonly PathCommand[]; bounds: PixelRect | null
} & Paint>
type Drawing = RectDraw | EllipseDraw | PathDraw

// Own paint records at the drawing boundary, including optional SVG stroke policy.
function copy_paint(paint: Paint): Paint {
  const { fill, stroke, stroke_width, stroke_linecap = 'butt',
    stroke_linejoin = 'miter', stroke_miterlimit = 4, opacity = 1 } = paint
  nonnegative(stroke_width, 'stroke_width')
  nonnegative(stroke_miterlimit, 'stroke_miterlimit')
  if (stroke_miterlimit < 1) throw new RangeError('stroke_miterlimit must be at least 1')
  if (!['butt', 'round', 'square'].includes(stroke_linecap)
    || !['miter', 'round', 'bevel'].includes(stroke_linejoin)) {
    throw new TypeError('Unknown stroke cap or join')
  }
  if (typeof fill !== 'string' || typeof stroke !== 'string') {
    throw new TypeError('Drawing paints must be strings')
  }
  finite(opacity, 'opacity')
  if (opacity < 0 || opacity > 1) throw new RangeError('opacity must be between 0 and 1')
  const stroke_dasharray = Object.freeze((paint.stroke_dasharray ?? []).map(value => nonnegative(value, 'stroke_dasharray')))
  return Object.freeze({
    fill, stroke, stroke_width, stroke_linecap, stroke_linejoin, stroke_miterlimit,
    stroke_dasharray, opacity,
  })
}

// Drawing commands contain final geometry and paint; the renderer only serializes.
function draw_rect(rect: PixelRect, paint: Paint, radius: PointValue = make_point()): RectDraw {
  const { x, y, width, height } = rect
  const pair = read_point(radius, 'radius')
  const rx = Math.min(nonnegative(pair.x, 'radius.x'), width / 2)
  const ry = Math.min(nonnegative(pair.y, 'radius.y'), height / 2)
  return Object.freeze({
    kind: 'rect', rect: make_rect(x, y, width, height), radius: make_point(rx, ry),
    ...copy_paint(paint),
  })
}

function draw_ellipse(center_value: PointValue, radius_value: PointValue, paint: Paint): EllipseDraw {
  const center = read_point(center_value, 'center'), radius = read_point(radius_value, 'radius')
  nonnegative(radius.x, 'radius.x'); nonnegative(radius.y, 'radius.y')
  return Object.freeze({
    kind: 'ellipse', center: make_point(center.x, center.y),
    radius: make_point(radius.x, radius.y), ...copy_paint(paint),
  })
}

// Optional precise bounds come from a font provider; other paths use a control hull.
function draw_path(
  commands: readonly PathCommand[], paint: Paint, ink?: PixelRect | null,
): PathDraw {
  const path = copy_path(commands)
  const bounds = ink === undefined ? path_bounds(path) : ink
  return Object.freeze({
    kind: 'path', commands: path, ...copy_paint(paint),
    bounds: bounds && make_rect(bounds.x, bounds.y, bounds.width, bounds.height),
  })
}

function copy_drawing(draw: Drawing): Drawing {
  switch (draw.kind) {
    case 'rect': return draw_rect(draw.rect, draw, draw.radius)
    case 'ellipse': return draw_ellipse(draw.center, draw.radius, draw)
    case 'path': return draw_path(draw.commands, draw, draw.bounds)
    default: throw new TypeError('Unknown drawing kind')
  }
}

// Strokes straddle geometry. Curves use conservative bounds, enlarged for caps
// and miter joins. Zero-area rects/ellipses paint nothing; a stroked line can.
function drawing_ink(draw: Drawing): PixelRect | null {
  if (draw.opacity === 0) return null
  let bounds: PixelRect | null
  switch (draw.kind) {
    case 'rect': bounds = draw.rect; break
    case 'ellipse': {
      const { center, radius } = draw
      bounds = make_rect(center.x - radius.x, center.y - radius.y, 2 * radius.x, 2 * radius.y)
      break
    }
    case 'path': bounds = draw.bounds; break
  }
  if (!bounds) return null
  const { x, y, width, height } = bounds
  if (draw.kind !== 'path' && (width === 0 || height === 0)) return null
  const stroke = draw.stroke !== 'none' && draw.stroke_width > 0
  if (!stroke && (draw.fill === 'none' || width === 0 || height === 0)) return null
  if (width === 0 && height === 0 && (draw.stroke_linecap ?? 'butt') === 'butt') return null

  let factor = 1
  if (draw.kind === 'path') {
    const segments = draw.commands.filter(command => command.kind !== 'M').length
    if (segments > 1 && (draw.stroke_linejoin ?? 'miter') === 'miter') {
      factor = draw.stroke_miterlimit ?? 4
    }
    if (draw.stroke_linecap === 'square') factor = Math.max(factor, Math.SQRT2)
  }
  const pad = stroke ? draw.stroke_width * factor / 2 : 0
  return make_rect(x - pad, y - pad, width + 2 * pad, height + 2 * pad)
}

export { draw_rect, draw_ellipse, draw_path, copy_drawing, drawing_ink }
export type { Paint, RectDraw, EllipseDraw, PathDraw, Drawing }
