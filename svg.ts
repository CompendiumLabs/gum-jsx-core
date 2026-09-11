import type { Drawing } from './drawing';
import type { Fragment } from './fragment';
import type { Rect } from './geometry';

type SvgOptions = Readonly<{ title?: string; background?: string; id_prefix?: string }>;

// Escape text and quoted attributes; drawing records never contain raw SVG markup.
function escape_xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Layout values are already final pixels. Serialization performs no unit conversion.
function rect_attributes(rect: Rect): string {
  const { x, y, width, height } = rect;
  return `x="${x}" y="${y}" width="${width}" height="${height}"`;
}

// Each drawing kind has an explicit vocabulary, with no arbitrary attribute injection.
function render_drawing(draw: Drawing): string {
  const { rect, fill, stroke, stroke_width } = draw;
  const paint = `fill="${escape_xml(fill)}" stroke="${escape_xml(stroke)}"`;
  return `<rect ${rect_attributes(rect)} ${paint} stroke-width="${stroke_width}"/>`;
}

// Render an immutable result, allocating definition IDs only within this document.
function render_svg(fragment: Fragment, options: SvgOptions = {}): string {
  const { width, height } = fragment.size;
  const { title, background, id_prefix = 'gum' } = options;
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id_prefix)) {
    throw new TypeError('SVG id_prefix must be an identifier');
  }
  const definitions: string[] = [];
  const clips = new Map<Fragment, string>();

  // Shared fragments reuse their local clip definition across placements.
  function render_fragment(node: Fragment): string {
    let clip = '';
    if (node.clip) {
      let id = clips.get(node);
      if (!id) {
        id = `${id_prefix}-clip-${clips.size}`;
        clips.set(node, id);
        const rect = `<rect ${rect_attributes(node.clip)}/>`;
        definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${rect}</clipPath>`);
      }
      clip = ` clip-path="url(#${id})"`;
    }
    const draw = node.draw.map(render_drawing);
    const children = node.children.map(child => {
      const { x, y } = child.offset;
      const matrix = child.transform ? ` matrix(${child.transform.join(' ')})` : '';
      return `<g transform="translate(${x} ${y})${matrix}">${render_fragment(child.fragment)}</g>`;
    });
    return `<g${clip}>${[...draw, ...children].join('')}</g>`;
  }

  const body = render_fragment(fragment);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}" overflow="hidden">`];
  if (title !== undefined) parts.push(`<title>${escape_xml(title)}</title>`);
  if (definitions.length) parts.push(`<defs>${definitions.join('')}</defs>`);
  if (background !== undefined) {
    parts.push(`<rect width="${width}" height="${height}" fill="${escape_xml(background)}"/>`);
  }
  return [...parts, body, '</svg>'].join('');
}

export { render_svg };
export type { SvgOptions };
