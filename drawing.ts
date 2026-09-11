import { nonnegative } from './checks';
import { make_rect } from './geometry';
import type { Rect as PixelRect } from './geometry';

type Paint = Readonly<{ fill: string; stroke: string; stroke_width: number }>;
type RectDraw = Readonly<{ kind: 'rect'; rect: PixelRect } & Paint>;
type Drawing = RectDraw;

// Drawing commands contain final geometry and paint; the renderer only serializes.
function draw_rect(rect: PixelRect, paint: Paint): RectDraw {
  const { x, y, width, height } = rect;
  const { fill, stroke, stroke_width } = paint;
  nonnegative(stroke_width, 'stroke_width');
  if (typeof fill !== 'string' || typeof stroke !== 'string') {
    throw new TypeError('Drawing paints must be strings');
  }
  return Object.freeze({
    kind: 'rect', rect: make_rect(x, y, width, height), fill, stroke, stroke_width,
  });
}

// SVG rect strokes straddle their path; zero-area rectangles paint nothing.
function drawing_ink(draw: Drawing): PixelRect | null {
  const { rect, fill, stroke, stroke_width } = draw;
  const { x, y, width, height } = rect;
  if (width === 0 || height === 0) return null;
  const pad = stroke === 'none' ? 0 : stroke_width / 2;
  if (fill === 'none' && pad === 0) return null;
  return make_rect(x - pad, y - pad, width + 2 * pad, height + 2 * pad);
}

export { draw_rect, drawing_ink };
export type { Paint, RectDraw, Drawing };
