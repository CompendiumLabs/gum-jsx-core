import type { Drawing, TextDraw } from './engine/drawing'
import type { Fragment } from './engine/fragment'
import type { Point, Rect, RectRadii } from './engine/geometry'
import { path_data } from './engine/path'
import { output_number_formatter } from './engine/output_number'
import type { OutputPrecision } from './engine/output_number'

type SvgOptions = Readonly<{ title?: string; background?: string; id_prefix?: string; precision?: OutputPrecision }>
const IDENTITY = [1, 0, 0, 1, 0, 0] as const

// Escape text and quoted attributes; drawing records never contain raw SVG markup.
function escape_xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Layout values are already final pixels. Serialization performs no unit conversion.
function rect_attributes(rect: Rect, number: (value: number) => string): string {
  const { x, y, width, height } = rect
  return `x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}"`
}

// SVG rects have one radius pair; separate corners need an outline of exact arcs.
// Use the same outline for decoration and clipping so their edges coincide.
function render_rect(rect: Rect, number: (value: number) => string, radius?: RectRadii, paint = ''): string {
  if (!radius || 'x' in radius || rect.width === 0 || rect.height === 0) {
    const rounded = radius && 'x' in radius ? ` rx="${number(radius.x)}" ry="${number(radius.y)}"` : ''
    return `<rect ${rect_attributes(rect, number)}${rounded}${paint ? ` ${paint}` : ''}/>`
  }
  const { x, y, width, height } = rect, right = x + width, bottom = y + height
  // A zero radius on either axis makes that corner square, as on SVG rects.
  const square = (r: Point) => r.x === 0 || r.y === 0 ? { x: 0, y: 0 } : r
  const tl = square(radius.tl), tr = square(radius.tr), br = square(radius.br), bl = square(radius.bl)
  const arc = (r: Point, x: number, y: number) => r.x && r.y
    ? `A${number(r.x)} ${number(r.y)} 0 0 1 ${number(x)} ${number(y)}` : `L${number(x)} ${number(y)}`
  const d = `M${number(x + tl.x)} ${number(y)}L${number(right - tr.x)} ${number(y)}`
    + arc(tr, right, y + tr.y) + `L${number(right)} ${number(bottom - br.y)}`
    + arc(br, right - br.x, bottom) + `L${number(x + bl.x)} ${number(bottom)}`
    + arc(bl, x, bottom - bl.y) + `L${number(x)} ${number(y + tl.y)}` + arc(tl, x + tl.x, y) + 'Z'
  return `<path d="${d}"${paint ? ` ${paint}` : ''}/>`
}

function render_text(draw: TextDraw, number: (value: number) => string, spans?: string): string {
  // Ordinary family names need no inner quotes. Quote punctuation and CSS keywords.
  const bare_family = /^[a-z_][\w-]*(?: [a-z_][\w-]*)*$/i.test(draw.font_family)
    && !/^(?:inherit|initial|unset|revert|revert-layer|default|serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|caption|icon|menu|message-box|small-caption|status-bar)$/i.test(draw.font_family)
  const family = bare_family ? draw.font_family : `'${draw.font_family.replace(/[\\']/g, '\\$&')}'`
  const anchor = draw.text_anchor ?? 'middle'
  const typography = (draw.font_weight === undefined || draw.font_weight === 400 ? '' : ` font-weight="${number(draw.font_weight)}"`)
    + ((draw.font_style === undefined || draw.font_style === 'normal') && !draw.font_oblique ? ''
      : ` font-style="${draw.font_oblique ? 'oblique 12deg' : draw.font_style}"`)
  return `<text x="${number(draw.origin.x + (anchor === 'middle' ? draw.advance / 2 : 0))}" y="${number(draw.origin.y)}"`
    + (anchor === 'start' ? '' : ` text-anchor="${anchor}"`)
    + ` font-family="${escape_xml(family)}" font-size="${number(draw.font_size)}" fill="${escape_xml(draw.fill)}"`
    + typography
    + `${spans === undefined && draw.opacity !== undefined && draw.opacity !== 1 ? ` opacity="${number(draw.opacity)}"` : ''}>${spans ?? escape_xml(draw.text)}</text>`
}

// Share typography within a line, keeping each word's measured position and
// separate opacity compositing. Color clusters retain their centered anchors.
function render_drawings(drawings: readonly Drawing[], number: (value: number) => string): string[] {
  const result: string[] = []
  for (let index = 0; index < drawings.length; index++) {
    const first = drawings[index]
    let end = index + 1
    if (first.kind === 'text' && first.text_anchor === 'start' && first.color_font === false) {
      while (end < drawings.length) {
        const next = drawings[end]
        if (next.kind !== 'text' || next.text_anchor !== first.text_anchor || next.color_font !== first.color_font
          || next.origin.y !== first.origin.y || next.font_family !== first.font_family || next.font_size !== first.font_size
          || next.font_weight !== first.font_weight || next.font_style !== first.font_style
          || next.font_oblique !== first.font_oblique || next.fill !== first.fill || next.opacity !== first.opacity) break
        end++
      }
    }
    if (first.kind !== 'text' || end === index + 1) {
      result.push(render_drawing(first, number))
      continue
    }
    const spans: string[] = []
    for (; index < end; index++) {
      const word = drawings[index] as TextDraw
      const opacity = word.opacity !== undefined && word.opacity !== 1 ? ` opacity="${number(word.opacity)}"` : ''
      spans.push(`<tspan x="${number(word.origin.x)}"${opacity}>${escape_xml(word.text)}</tspan>`)
    }
    result.push(render_text(first, number, spans.join('')))
    index--
  }
  return result
}

// Each drawing kind has an explicit vocabulary, with no arbitrary attribute injection.
function render_drawing(draw: Drawing, number: (value: number) => string): string {
  if (draw.kind === 'image') {
    return `<image ${rect_attributes(draw.rect, number)} xlink:href="${escape_xml(draw.data)}"`
      + ` preserveAspectRatio="none"${draw.opacity !== undefined && draw.opacity !== 1 ? ` opacity="${number(draw.opacity)}"` : ''}/>`
  }
  if (draw.kind === 'text') return render_text(draw, number)
  const { fill, stroke, stroke_width, stroke_linecap = 'butt',
    stroke_linejoin = 'miter', stroke_miterlimit = 4 } = draw
  const paint = `fill="${escape_xml(fill)}" stroke="${escape_xml(stroke)}"`
    + ` stroke-width="${number(stroke_width)}" stroke-linecap="${stroke_linecap}"`
    + ` stroke-linejoin="${stroke_linejoin}" stroke-miterlimit="${number(stroke_miterlimit)}"`
    + (draw.stroke_dasharray?.some(value => value > 0) ? ` stroke-dasharray="${draw.stroke_dasharray.map(number).join(' ')}"` : '')
    + (draw.opacity !== undefined && draw.opacity !== 1 ? ` opacity="${number(draw.opacity)}"` : '')
  switch (draw.kind) {
    case 'rect': return render_rect(draw.rect, number, draw.radius, paint)
    case 'ellipse': {
      const { center, radius } = draw
      return `<ellipse cx="${number(center.x)}" cy="${number(center.y)}" rx="${number(radius.x)}" ry="${number(radius.y)}" ${paint}/>`
    }
    case 'path': return `<path d="${path_data(draw.commands, number)}" ${paint}/>`
  }
}

// Keep diagnostic strokes legible through fitting, including zero-sized allocations.
function render_debug_box(rect: Rect, kind: 'allocated' | 'content', number: (value: number) => string): string {
  const paint = `data-gum-debug-box="${kind}" stroke="${kind === 'allocated' ? '#e11d48' : '#2563eb'}"`
    + ' vector-effect="non-scaling-stroke"' + (kind === 'content' ? ' stroke-dasharray="4 3"' : '')
  if (rect.width === 0 || rect.height === 0) {
    return `<path d="M${number(rect.x)} ${number(rect.y)}l${number(rect.width)} ${number(rect.height)}" ${paint} stroke-linecap="round"/>`
  }
  return render_rect(rect, number, undefined, paint)
}

// Render an immutable result, allocating definition IDs only within this document.
function render_svg(fragment: Fragment, options: SvgOptions = {}): string {
  const { width, height } = fragment.size
  const { title, background, id_prefix = 'gum' } = options
  const number = output_number_formatter(options.precision)
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id_prefix)) {
    throw new TypeError('SVG id_prefix must be an identifier')
  }
  const definitions: string[] = []
  const clips = new Map<Fragment, string>()
  const path_clips = new Map<Fragment, string>()
  const debug: string[] = []

  // Shared fragments reuse their local clip definition across placements.
  function render_fragment(node: Fragment, transform = ''): string {
    if (node.debug) {
      const boxes = render_debug_box({ x: 0, y: 0, ...node.size }, 'allocated', number)
        + (node.content ? render_debug_box(node.content, 'content', number) : '')
      debug.push(transform ? `<g transform="${transform}">${boxes}</g>` : boxes)
    }
    let clip = ''
    if (node.clip) {
      let id = clips.get(node)
      if (!id) {
        id = `${id_prefix}-clip-${clips.size}`
        clips.set(node, id)
        const rect = render_rect(node.clip, number, node.clip.radius)
        definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${rect}</clipPath>`)
      }
      clip = ` clip-path="url(#${id})"`
    }
    let path_clip = ''
    if (node.clip_path !== undefined) {
      let id = path_clips.get(node)
      if (!id) {
        id = `${id_prefix}-path-clip-${path_clips.size}`
        path_clips.set(node, id)
        definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${path_data(node.clip_path, number)}"/></clipPath>`)
      }
      path_clip = ` clip-path="url(#${id})"`
    }
    const draw = render_drawings(node.draw, number)
    const children = node.children.map(child => {
      const { x, y } = child.offset
      const transforms: string[] = []
      if (x !== 0 || y !== 0) transforms.push(`translate(${number(x)} ${number(y)})`)
      if (child.transform?.some((value, index) => value !== IDENTITY[index])) {
        transforms.push(`matrix(${child.transform.map(number).join(' ')})`)
      }
      const placement_transform = transforms.join(' ')
      const body = render_fragment(child.fragment, [transform, placement_transform].filter(Boolean).join(' '))
      return placement_transform ? `<g transform="${placement_transform}">${body}</g>` : body
    })

    // Layout hierarchy needs no matching SVG group unless it carries clipping.
    let body = [...draw, ...children].join('')
    if (path_clip) body = `<g${path_clip}>${body}</g>`
    return clip ? `<g${clip}>${body}</g>` : body
  }

  const body = render_fragment(fragment)
  const image_namespace = body.includes('<image ') ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : ''
  // Establish inherited text settings once, including when embedded in a styled page.
  const text_defaults = body.includes('<text ')
    ? ' text-anchor="start" font-weight="400" font-style="normal" xml:space="preserve"' : ''
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg"${image_namespace} width="${number(width)}" height="${number(height)}"`,
    ` viewBox="0 0 ${number(width)} ${number(height)}" overflow="hidden"${text_defaults}>`]
  if (title !== undefined) parts.push(`<title>${escape_xml(title)}</title>`)
  if (definitions.length) parts.push(`<defs>${definitions.join('')}</defs>`)
  if (background !== undefined) {
    parts.push(`<rect width="${number(width)}" height="${number(height)}" fill="${escape_xml(background)}"/>`)
  }
  // Diagnostics sit above all paint and outside content clips; the viewport still clips.
  const overlay = debug.length ? '<g data-gum-debug="" fill="none" stroke-width="1"'
    + ` pointer-events="none" aria-hidden="true">${debug.join('')}</g>` : ''
  return [...parts, body, overlay, '</svg>'].join('')
}

export { render_svg }
export type { SvgOptions }
