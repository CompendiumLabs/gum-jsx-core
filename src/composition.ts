import { finite } from './checks';
import type { Element } from './element';
import { place_fragment, transform_guides } from './fragment';
import {
  make_size, make_point, make_rect, make_insets, deflate_size, inflate_size, bounds_overflow,
} from './geometry';
import type { Insets, Size } from './geometry';
import { available, exact, make_request, deflate_request, finish_size } from './layout';
import type { LayoutRequest, Sizing } from './layout';
import type { LayoutQuery } from './pass';
import type { ReferenceBox } from './units';

type AlignmentValue = number | 'start' | 'center' | 'end' | 'stretch';
type Alignment = AlignmentValue | Readonly<{ x?: AlignmentValue; y?: AlignmentValue }>;
type ResolvedAlignment = Readonly<{ x: number | 'stretch'; y: number | 'stretch' }>;
type FitMode = 'contain' | 'cover' | 'scale_down';

// Alignment values are dimensionless: 0/start, 0.5/center, and 1/end.
function resolve_alignment(align: Alignment = 'start', path = 'alignment'): ResolvedAlignment {
  const axes = typeof align === 'object' ? align : { x: align, y: align };
  function resolve(value: AlignmentValue = 'start'): number | 'stretch' {
    if (value === 'stretch') return value;
    const fraction = typeof value === 'number' ? value
      : { start: 0, center: 0.5, end: 1 }[value];
    finite(fraction, path);
    if (fraction < 0 || fraction > 1) throw new RangeError(`${path} must be between 0 and 1`);
    return fraction;
  }
  return Object.freeze({ x: resolve(axes.x), y: resolve(axes.y) });
}

// Oversized content can align outside the frame; keep the resulting negative offset.
function align_offset(size: Size, child: Size, align: ResolvedAlignment) {
  return make_point(
    (size.width - child.width) * (align.x === 'stretch' ? 0 : align.x),
    (size.height - child.height) * (align.y === 'stretch' ? 0 : align.y),
  );
}

// Exact allocations and equal min/max limits establish axes independently of a
// child. An ordinary available offer remains a budget for a hugging container.
function definite_reference(request: LayoutRequest, sizing: Sizing): ReferenceBox {
  const result: { width?: number; height?: number } = {};
  for (const axis of ['width', 'height'] as const) {
    const offer = request[axis], rule = sizing[axis];
    if (offer.kind === 'exact') result[axis] = offer.value;
    else if (rule.min === rule.max) result[axis] = rule.min;
  }
  return Object.freeze(result);
}

// One-child layout is deflate → query → inflate → align. The child's natural
// answer sets hugging axes, while definite axes provide percentage references.
// Stretch sends exact requests only on axes established before measurement.
// No second query or element reconstruction is needed for ordinary alignment.
function layout_content(
  child: Element | undefined, query: LayoutQuery, insets: Insets = make_insets(),
  alignment: Alignment = 'start',
) {
  const align = resolve_alignment(alignment);
  const inner = deflate_request(query.request, insets);
  const fixed = definite_reference(query.request, query.sizing);
  const reference = Object.freeze({
    ...(fixed.width === undefined ? {} : {
      width: Math.max(0, fixed.width - insets.left - insets.right),
    }),
    ...(fixed.height === undefined ? {} : {
      height: Math.max(0, fixed.height - insets.top - insets.bottom),
    }),
  });
  const request = make_request({
    width: align.x === 'stretch' && reference.width !== undefined ? exact(reference.width)
      : inner.width.kind === 'exact' ? available(inner.width.value) : inner.width,
    height: align.y === 'stretch' && reference.height !== undefined ? exact(reference.height)
      : inner.height.kind === 'exact' ? available(inner.height.value) : inner.height,
  });
  const fragment = child ? query.child(child, request, reference) : undefined;
  const measured = fragment?.size ?? make_size();
  const extent = inflate_size(measured, insets);
  const size = finish_size(extent, query.request, query.sizing);
  const area = deflate_size(size, insets);
  const content = make_rect(insets.left, insets.top, area.width, area.height);

  const shift = fragment ? align_offset(area, measured, align) : make_point();
  const offset = make_point(content.x + shift.x, content.y + shift.y);
  const placement = fragment ? place_fragment(fragment, offset) : undefined;
  const guides = transform_guides(fragment?.guides ?? {}, offset.y);
  const bounds = make_rect(shift.x, shift.y, extent.width, extent.height);
  return { size, content, placement, guides, overflow: bounds_overflow(size, bounds) };
}

// Fit whole fragments uniformly. A zero source axis contributes no ratio; empty
// sources keep scale 1. An offered zero on a nonzero axis can produce scale 0.
function fit_scale(source: Size, target: ReferenceBox, mode: FitMode): number {
  if (!['contain', 'cover', 'scale_down'].includes(mode)) throw new TypeError('Unknown fit mode');
  const ratios = (['width', 'height'] as const).flatMap(axis => {
    const value = target[axis];
    return value === undefined || source[axis] === 0 ? [] : [value / source[axis]];
  });
  const scale = !ratios.length ? 1 : mode === 'cover' ? Math.max(...ratios) : Math.min(...ratios);
  return finite(mode === 'scale_down' ? Math.min(1, scale) : scale, 'fit scale');
}

export { resolve_alignment, align_offset, definite_reference, layout_content, fit_scale };
export type { AlignmentValue, Alignment, ResolvedAlignment, FitMode };
