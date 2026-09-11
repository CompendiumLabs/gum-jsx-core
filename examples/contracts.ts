import {
  em, px, resolve_length, measure_length, resolve_font_size, resolve_line_height,
  make_size, make_point, make_rect, resolve_insets, inflate_size, bounds_overflow,
  natural, available, exact, make_request, deflate_request, resolve_sizing,
  prepare_request, finish_size, shape_size,
} from '../src/index';
import type { Fragment, LayoutRequest, Size } from '../src/index';

// These probes use measured stand-ins. Real elements and drawing arrive in stage 2.
function units() {
  const font_size = resolve_font_size();
  const basis = { font_size, fraction: 640 };
  return {
    lengths: [px(10), em(2), 0.5].map(length => ({
      length, pixels: resolve_length(length, basis),
    })),
    inherited_font: resolve_font_size(em(2), font_size),
    line_height: resolve_line_height(),
    indefinite: measure_length(0.5),
    known_zero: resolve_length(0.5, { fraction: 0 }),
    absolute_zero: resolve_length(0),
  };
}

// The root has explicit pixel dimensions; requests carry resolved pixels.
function fixed_viewport() {
  const viewport = resolve_sizing({ width: px(640), height: px(360) });
  const request = prepare_request(make_request(), viewport);
  return { request, size: finish_size(make_size(), request, viewport) };
}

// The reference survives trial allocation, including a smaller exact slot.
function half_width() {
  const context = { reference: { width: 640 }, path: 'root/child' };
  const sizing = resolve_sizing({ width: 0.5 }, context);
  const offers = [available(400), available(80), exact(80)];
  return offers.map(width => {
    const request = make_request({ width });
    return {
      offer: width,
      preferred: sizing.width.preferred,
      size: finish_size(make_size(20, 20), request, sizing),
    };
  });
}

// An unpainted measurement fragment makes the layout tree inspectable now.
function measured_fragment(size: Size, baseline?: number): Fragment<never> {
  const guides = baseline === undefined ? {} : { baseline };
  return Object.freeze({
    size,
    guides: Object.freeze(guides),
    ink: null,
    overflow: bounds_overflow(size, null),
    draw: Object.freeze([]),
    children: Object.freeze([]),
  });
}

// Exercise the box arithmetic without implementing a Box element ahead of stage 4.
function padded_measurement(request: LayoutRequest, content: Fragment<never>) {
  const padding = resolve_insets(em(0.5), { font_size: 16 });
  const inner = deflate_request(request, padding);
  const extent = inflate_size(content.size, padding);
  const size = finish_size(extent, request, resolve_sizing());
  const bounds = make_rect(0, 0, extent.width, extent.height);

  const offset = make_point(padding.left, padding.top);
  const baseline = content.guides.baseline;
  const guides = baseline === undefined ? {} : { baseline: baseline + offset.y };
  const fragment: Fragment<never> = Object.freeze({
    size,
    guides: Object.freeze(guides),
    ink: null,
    overflow: bounds_overflow(size, bounds),
    draw: Object.freeze([]),
    children: Object.freeze([Object.freeze({ fragment: content, offset })]),
  });
  return { padding, inner, fragment };
}

// A previously measured 96×20 text line, with a baseline 15px from its top.
function hugging_box() {
  const request = make_request({ width: available(300) });
  return padded_measurement(request, measured_fragment(make_size(96, 20), 15));
}

// Padding alone exceeds this exact box. The child gets zero, and overflow remains.
function oversized_padding() {
  const request = make_request({ width: exact(10), height: exact(8) });
  return padded_measurement(request, measured_fragment(make_size()));
}

// Preferred aspect yields to two exact dimensions, without a scaling transform.
function shape_defaults() {
  const sizing = resolve_sizing({ aspect: 2 });
  return {
    natural: shape_size(make_request(), sizing),
    available: shape_size(make_request({ width: available(80) }), sizing),
    exact_width: shape_size(make_request({
      width: exact(80), height: available(10),
    }), sizing),
    exact_box: shape_size(make_request({ width: exact(80), height: exact(10) }), sizing),
    empty: finish_size(make_size(), make_request({ width: natural() }), resolve_sizing()),
  };
}

const probes = Object.freeze({
  units, fixed_viewport, half_width, hugging_box, oversized_padding, shape_defaults,
});

export { probes };
