import {
  define_element, em, px, resolve_length, make_size, make_rect,
  finish_size, bounds_overflow, make_fragment, draw_rect,
  clamp, floor, ceil,
} from '../src/index';
import type { ElementProps, LayoutQuery, Length, Size } from '../src/index';

type LeafProps = ElementProps & Readonly<{
  content_width?: Length;
  content_height?: Length;
  count?: number;
}>;

// Synthetic content keeps its measured geometry when an exact frame is smaller.
function paint_leaf(content: Size, query: LayoutQuery) {
  const size = finish_size(content, query.request, query.sizing);
  const rect = make_rect(0, 0, content.width, content.height);
  const draw = draw_rect(rect, { fill: query.style.fill, stroke: 'none', stroke_width: 0 });
  return make_fragment({
    size, draw: [draw], overflow: bounds_overflow(size, rect),
    guides: { baseline: content.height * 0.8 },
  });
}

// A fixed leaf refuses to reflow, but still obeys its allocated size.
const Fixed = define_element<LeafProps>('Fixed', (props, query) => {
  const { font_size } = query.style;
  const width = resolve_length(props.content_width ?? px(96), {
    font_size, fraction: query.reference.width,
  }, `${query.path}.content_width`);
  const height = resolve_length(props.content_height ?? px(20), {
    font_size, fraction: query.reference.height,
  }, `${query.path}.content_height`);
  return paint_leaf(make_size(width, height), query);
});

// An expanding leaf accepts each offered axis independently.
const Expanding = define_element('Expanding', (_props, query) => {
  const { width, height } = query.request;
  return paint_leaf(make_size(
    width.kind === 'natural' ? 16 : width.value,
    height.kind === 'natural' ? 16 : height.value,
  ), query);
});

// Equal 1em cells stand in for wrapping text, including a sharp width boundary.
const Wrapping = define_element<LeafProps>('Wrapping', (props, query) => {
  const count = props.count ?? 6;
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const unit = resolve_length(em(1), { font_size: query.style.font_size });
  const { width } = query.request;
  const columns = width.kind === 'natural' || unit === 0 ? count
    : clamp(floor(width.value / unit), [1, count]);
  const rows = ceil(count / columns);
  return paint_leaf(make_size(columns * unit, rows * unit), query);
});

export { Fixed, Expanding, Wrapping };
