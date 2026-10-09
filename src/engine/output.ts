import { freeze_owned } from '../lib/immutable'
import { draw_path } from './drawing'
import type { Drawing } from './drawing'
import { make_fragment } from './fragment'
import type { Fragment } from './fragment'
import { make_point } from './geometry'
import type { Rect, Transform } from './geometry'
import { transform_path } from './path'
import type { PathCommand } from './path'

const IDENTITY: Transform = [1, 0, 0, 1, 0, 0]

// Compose each placement into final viewport coordinates before adding outlines.
function multiply(left: Transform, right: Transform): Transform {
  const [a, b, c, d, e, f] = left, [g, h, i, j, k, l] = right
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f]
}

// Ordinary paths keep a one-pixel stroke through fitting, including empty boxes.
function debug_box(rect: Rect, content: boolean, transform: Transform): Drawing {
  const { x, y, width, height } = rect
  const empty = width === 0 || height === 0
  const commands: readonly PathCommand[] = empty
    ? [{ kind: 'M', x, y }, { kind: 'L', x: x + width, y: y + height }]
    : [{ kind: 'M', x, y }, { kind: 'L', x: x + width, y },
      { kind: 'L', x: x + width, y: y + height },
      { kind: 'L', x, y: y + height }, { kind: 'Z' }]
  return draw_path(transform_path(commands, transform), {
    fill: 'none', stroke: content ? '#2563eb' : '#e11d48', stroke_width: 1,
    stroke_dasharray: content ? [4, 3] : [], stroke_linecap: empty ? 'round' : 'butt',
  })
}

// Lower rendering metadata to ordinary fragments after layout. Consuming debug
// flags makes preparation idempotent, including after a JSON round trip. Layout
// geometry and the original immutable tree remain unchanged.
function prepare_render(fragment: Fragment): Fragment {
  const outlines: Drawing[] = []
  function visit(node: Fragment, transform: Transform): Fragment {
    if (node.debug) {
      outlines.push(debug_box({ x: 0, y: 0, ...node.size }, false, transform))
      if (node.content) outlines.push(debug_box(node.content, true, transform))
    }
    const children = node.children.map(child => {
      const [a, b, c, d, e, f] = child.transform ?? IDENTITY
      const matrix = multiply(transform, [a, b, c, d, e + child.offset.x, f + child.offset.y])
      const next = visit(child.fragment, matrix)
      return next === child.fragment ? child : freeze_owned({ ...child, fragment: next })
    })
    if (!node.debug && children.every((child, index) => child === node.children[index])) return node
    const { debug, ...source } = node
    return freeze_owned({ ...source, children: freeze_owned(children) })
  }

  const source = visit(fragment, IDENTITY)
  if (!outlines.length) return fragment
  const overlay = make_fragment({ name: 'DebugOverlay', size: fragment.size, draw: outlines })
  const offset = make_point()
  // Keep all source clips on the artwork branch. The overlay is its final
  // sibling, so only the renderer's viewport clips it. Retain measured bounds.
  const { debug, clip, clip_path, draw, children, ...metadata } = fragment
  return freeze_owned({ ...metadata, draw: freeze_owned([]), children: freeze_owned([
    freeze_owned({ fragment: source, offset }), freeze_owned({ fragment: overlay, offset }),
  ]) })
}

// Export backends can use this entry point without loading layout or fonts.
export { prepare_render, transform_path }
export { DEFAULT_OUTPUT_PRECISION, output_number_formatter } from './output_number'
export type { OutputPrecision } from './output_number'
