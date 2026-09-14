import type { Drawing } from './engine/drawing'
import type { Fragment } from './engine/fragment'
import type { Rect } from './engine/geometry'
import { path_data } from './engine/path'

type SvgOptions = Readonly<{ title?: string; background?: string; id_prefix?: string }>
const IDENTITY = [1, 0, 0, 1, 0, 0] as const

// Escape text and quoted attributes; drawing records never contain raw SVG markup.
function escape_xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Layout values are already final pixels. Serialization performs no unit conversion.
function rect_attributes(rect: Rect): string {
  const { x, y, width, height } = rect
  return `x="${x}" y="${y}" width="${width}" height="${height}"`
}

// Each drawing kind has an explicit vocabulary, with no arbitrary attribute injection.
function render_drawing(draw: Drawing): string {
  const { fill, stroke, stroke_width, stroke_linecap = 'butt',
    stroke_linejoin = 'miter', stroke_miterlimit = 4 } = draw
  const paint = `fill="${escape_xml(fill)}" stroke="${escape_xml(stroke)}"`
    + ` stroke-width="${stroke_width}" stroke-linecap="${stroke_linecap}"`
    + ` stroke-linejoin="${stroke_linejoin}" stroke-miterlimit="${stroke_miterlimit}"`
    + (draw.stroke_dasharray?.some(value => value > 0) ? ` stroke-dasharray="${draw.stroke_dasharray.join(' ')}"` : '')
    + (draw.opacity !== undefined && draw.opacity !== 1 ? ` opacity="${draw.opacity}"` : '')
  switch (draw.kind) {
    case 'rect': {
      const { radius } = draw
      const rounded = radius ? ` rx="${radius.x}" ry="${radius.y}"` : ''
      return `<rect ${rect_attributes(draw.rect)}${rounded} ${paint}/>`
    }
    case 'ellipse': {
      const { center, radius } = draw
      return `<ellipse cx="${center.x}" cy="${center.y}" rx="${radius.x}" ry="${radius.y}" ${paint}/>`
    }
    case 'path': return `<path d="${path_data(draw.commands)}" ${paint}/>`
  }
}

// Render an immutable result, allocating definition IDs only within this document.
function render_svg(fragment: Fragment, options: SvgOptions = {}): string {
  const { width, height } = fragment.size
  const { title, background, id_prefix = 'gum' } = options
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id_prefix)) {
    throw new TypeError('SVG id_prefix must be an identifier')
  }
  const definitions: string[] = []
  const clips = new Map<Fragment, string>()

  // Shared fragments reuse their local clip definition across placements.
  function render_fragment(node: Fragment): string {
    let clip = ''
    if (node.clip) {
      let id = clips.get(node)
      if (!id) {
        id = `${id_prefix}-clip-${clips.size}`
        clips.set(node, id)
        const { radius } = node.clip
        const corners = radius ? ` rx="${radius.x}" ry="${radius.y}"` : ''
        const rect = `<rect ${rect_attributes(node.clip)}${corners}/>`
        definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${rect}</clipPath>`)
      }
      clip = ` clip-path="url(#${id})"`
    }
    const draw = node.draw.map(render_drawing)
    const children = node.children.map(child => {
      const { x, y } = child.offset
      const transforms: string[] = []
      if (x !== 0 || y !== 0) transforms.push(`translate(${x} ${y})`)
      if (child.transform?.some((value, index) => value !== IDENTITY[index])) {
        transforms.push(`matrix(${child.transform.join(' ')})`)
      }
      const body = render_fragment(child.fragment)
      return transforms.length ? `<g transform="${transforms.join(' ')}">${body}</g>` : body
    })

    // Layout hierarchy needs no matching SVG group unless it carries semantics.
    const label = node.label === undefined ? '' : ` role="img" aria-label="${escape_xml(node.label)}"`
    const body = [...draw, ...children].join('')
    return clip || label ? `<g${clip}${label}>${body}</g>` : body
  }

  const body = render_fragment(fragment)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}" overflow="hidden">`]
  if (title !== undefined) parts.push(`<title>${escape_xml(title)}</title>`)
  if (definitions.length) parts.push(`<defs>${definitions.join('')}</defs>`)
  if (background !== undefined) {
    parts.push(`<rect width="${width}" height="${height}" fill="${escape_xml(background)}"/>`)
  }
  return [...parts, body, '</svg>'].join('')
}

export { render_svg }
export type { SvgOptions }
