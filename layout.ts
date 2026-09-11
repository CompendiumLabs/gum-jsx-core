import { nonnegative } from './checks';
import { DEFAULTS } from './defaults';
import { make_size } from './geometry';
import type { Insets, Size } from './geometry';
import { resolve_length } from './units';
import type { Length, LengthContext } from './units';

type Axis = 'width' | 'height';
type AxisRequest =
  | Readonly<{ kind: 'natural' }>
  | Readonly<{ kind: 'available' | 'exact'; value: number }>;
type LayoutRequest = Readonly<Record<Axis, AxisRequest>>;

type SizeKey = Axis | `min_${Axis}` | `max_${Axis}`;
type SizeSpec = Readonly<Partial<Record<SizeKey, Length>> & { aspect?: number }>;
type AxisSizing = Readonly<{ preferred?: number; min: number; max: number }>;
type Sizing = Readonly<Record<Axis, AxisSizing> & { aspect?: number }>;

const NATURAL = Object.freeze({ kind: 'natural' });

// Requests are in pixels. Natural is distinct from an infinite numeric offer.
function natural() {
  return NATURAL;
}

// An advisory offer can be exceeded by content that cannot fit.
function available(value: number) {
  return Object.freeze({ kind: 'available', value: nonnegative(value, 'available') });
}

// A hard allocation fixes the reported dimension, allowing separate overflow.
function exact(value: number) {
  return Object.freeze({ kind: 'exact', value: nonnegative(value, 'exact') });
}

// Copy both axes to own their values, with natural requests for omitted axes.
function make_request(axes: Partial<LayoutRequest> = {}): LayoutRequest {
  function copy_axis(axis: AxisRequest = natural()): AxisRequest {
    if (axis.kind === 'natural') return natural();
    return axis.kind === 'exact' ? exact(axis.value) : available(axis.value);
  }
  return Object.freeze({
    width: copy_axis(axes.width),
    height: copy_axis(axes.height),
  });
}

// Deflate the offer without changing any percentage reference in the context.
function deflate_request(request: LayoutRequest, insets: Insets): LayoutRequest {
  function deflate_axis(axis: AxisRequest, amount: number): AxisRequest {
    if (axis.kind === 'natural') return axis;
    const value = Math.max(0, axis.value - amount);
    return axis.kind === 'exact' ? exact(value) : available(value);
  }
  const { left, top, right, bottom } = insets;
  return make_request({
    width: deflate_axis(request.width, left + right),
    height: deflate_axis(request.height, top + bottom),
  });
}

// Resolve against the established parent box, never a temporary child offer.
function resolve_sizing(spec: SizeSpec = {}, context: LengthContext = {}): Sizing {
  const { font_size, reference = {}, path = 'root' } = context;

  function resolve_axis(axis: Axis): AxisSizing {
    const basis = { font_size, fraction: reference[axis] };
    function resolve(key: SizeKey): number | undefined {
      const length = spec[key];
      if (length === undefined) return undefined;
      const location = `${path}.${key}`;
      return nonnegative(resolve_length(length, basis, location), location);
    }

    const preferred = resolve(axis);
    const min = resolve(`min_${axis}`) ?? 0;
    const max = resolve(`max_${axis}`) ?? Infinity;
    if (min > max) {
      throw new RangeError(`${path}: min_${axis} exceeds max_${axis}`);
    }
    return Object.freeze({ preferred, min, max });
  }

  const { aspect } = spec;
  if (aspect !== undefined && nonnegative(aspect, `${path}.aspect`) === 0) {
    throw new RangeError(`${path}.aspect must be positive`);
  }
  return Object.freeze({
    width: resolve_axis('width'),
    height: resolve_axis('height'),
    aspect,
  });
}

// Clamp a preferred or measured dimension to the element's own limits.
function clamp_size(value: number, sizing: AxisSizing): number {
  return Math.max(sizing.min, Math.min(sizing.max, value));
}

// Parent allocations win; otherwise offer the child its resolved size policy.
function prepare_request(request: LayoutRequest, sizing: Sizing): LayoutRequest {
  function prepare_axis(axis: AxisRequest, rule: AxisSizing): AxisRequest {
    if (axis.kind === 'exact') return axis;
    if (rule.preferred !== undefined) return exact(clamp_size(rule.preferred, rule));
    if (axis.kind === 'available') return available(clamp_size(axis.value, rule));
    return rule.max < Infinity ? available(rule.max) : natural();
  }
  return make_request({
    width: prepare_axis(request.width, sizing.width),
    height: prepare_axis(request.height, sizing.height),
  });
}

// Select the allocated box after measurement. An available budget is advisory.
function finish_size(content: Size, request: LayoutRequest, sizing: Sizing): Size {
  const prepared = prepare_request(request, sizing);
  function finish_axis(value: number, axis: AxisRequest, rule: AxisSizing): number {
    return axis.kind === 'exact' ? axis.value : clamp_size(value, rule);
  }
  return make_size(
    finish_axis(content.width, prepared.width, sizing.width),
    finish_axis(content.height, prepared.height, sizing.height),
  );
}

// A shape fills its offer at its preferred aspect; an unoffered shape is finite.
// Exact dimensions take precedence over aspect, and one exact axis derives the other.
function shape_size(request: LayoutRequest, sizing: Sizing = resolve_sizing()): Size {
  const prepared = prepare_request(request, sizing);
  const { width, height } = prepared;
  const aspect = sizing.aspect ?? 1;
  let size: Size;

  if (width.kind === 'exact' && height.kind === 'exact') {
    size = make_size(width.value, height.value);
  } else if (width.kind === 'exact') {
    size = make_size(width.value, width.value / aspect);
  } else if (height.kind === 'exact') {
    size = make_size(height.value * aspect, height.value);
  } else {
    const max_width = width.kind === 'available' ? width.value : Infinity;
    const max_height = height.kind === 'available' ? height.value : Infinity;
    const limit = Math.min(max_height, max_width / aspect);
    const shape_height = limit < Infinity ? limit : DEFAULTS.shape_height;
    size = make_size(shape_height * aspect, shape_height);
  }

  // Own min/max limits may also override the preferred ratio.
  return finish_size(size, prepared, sizing);
}

export {
  natural, available, exact, make_request, deflate_request,
  resolve_sizing, prepare_request, finish_size, shape_size,
};
export type { Axis, AxisRequest, LayoutRequest, SizeSpec, AxisSizing, Sizing };
