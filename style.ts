import { DEFAULTS } from './defaults';
import { normalize_length, px, resolve_font_size } from './units';
import type { Length, NormalizedLength } from './units';

type StyleSpec = Readonly<{
  font_size?: Length;
  fill?: string;
  stroke?: string;
  stroke_width?: Length;
}>;
type Style = Readonly<{
  font_size: number;
  fill: string;
  stroke: string;
  stroke_width: NormalizedLength;
}>;

const DEFAULT_STYLE: Style = Object.freeze({
  font_size: DEFAULTS.font_size,
  fill: DEFAULTS.fill,
  stroke: DEFAULTS.stroke,
  stroke_width: normalize_length(px(DEFAULTS.stroke_width)),
});

// Resolve inherited font size before sizing. Paint lengths await shape geometry.
function resolve_style(spec: StyleSpec = {}, inherited = DEFAULT_STYLE, path = 'root'): Style {
  const font_size = resolve_font_size(spec.font_size, inherited.font_size, `${path}.font_size`);
  const fill = spec.fill ?? inherited.fill;
  const stroke = spec.stroke ?? inherited.stroke;
  if (typeof fill !== 'string' || typeof stroke !== 'string') {
    throw new TypeError(`${path}: fill and stroke must be paint strings`);
  }
  const stroke_width = normalize_length(spec.stroke_width ?? inherited.stroke_width);
  return Object.freeze({ font_size, fill, stroke, stroke_width });
}

export { resolve_style };
export type { StyleSpec, Style };
