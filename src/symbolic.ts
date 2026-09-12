import { finite } from './checks';
import { define_component, define_element } from './element';
import type { Element } from './element';
import { make_fragment, place_fragment } from './fragment';
import { make_point } from './geometry';
import type { Point } from './geometry';
import { exact, make_request } from './layout';
import { CoordLine, Spline, Points, Fill, mark_context, mark_bounds, arrow_draw } from './marks';
import type { CoordLineProps, SplineProps, PointsProps, FillProps, MarkProps } from './marks';
import { linspace, sample_points, sample_count, finite_point, scalar_value } from './sampling';
import type { PointValue, ScalarFunction, SampleProps } from './sampling';
import { px } from './units';
import type { Length } from './units';
import type { Limit } from './coordinates';

type SymLineProps = Omit<CoordLineProps, 'points'> & SampleProps;
type SymSplineProps = Omit<SplineProps, 'points'> & SampleProps;
type SymPointsProps = Omit<PointsProps, 'points'> & SampleProps;
type SymFillProps = Omit<FillProps, 'points' | 'boundary'> & Readonly<{
  upper?: ScalarFunction; lower?: ScalarFunction; xlim?: Limit; xvals?: readonly number[]; samples?: number;
  ylim?: Limit; yvals?: readonly number[];
}>;
type VectorSample = Readonly<{ point: Point; vector: Point }>;
type FieldProps = MarkProps & Readonly<{
  vectors?: readonly VectorSample[]; scale?: number; normalize?: boolean;
  head_size?: Length; head_width?: number;
  shape?: Element | ((sample: VectorSample, index: number) => Element); shape_height?: Length;
}>;
type FieldDatum = Readonly<{ from: Point; to: Point; shape?: Element }>;
type FieldData = Omit<FieldProps, 'vectors' | 'shape'> & Readonly<{ vectors: readonly FieldDatum[] }>;
type SymFieldProps = Omit<FieldProps, 'vectors'> & Readonly<{
  f?: (x: number, y: number) => PointValue | null;
  xlim?: Limit; ylim?: Limit; xvals?: readonly number[]; yvals?: readonly number[];
  samples?: number | Readonly<{ x: number; y: number }>;
}>;

function split_samples<T extends SampleProps>(props: T) {
  const { f, fx, fy, xlim, ylim, tlim, xvals, yvals, tvals, samples, ...style } = props;
  return { style, points: sample_points({ f, fx, fy, xlim, ylim, tlim, xvals, yvals, tvals, samples }) };
}

const SymLine = define_component<SymLineProps>('SymLine', props => {
  const { style, points } = split_samples(props);
  return new CoordLine({ ...style, points });
});
const SymSpline = define_component<SymSplineProps>('SymSpline', props => {
  const { style, points } = split_samples(props);
  return new Spline({ ...style, points });
});
const SymPoly = define_component<SymLineProps>('SymPoly', props => {
  const { style, points } = split_samples(props);
  return new CoordLine({ ...style, points, closed: true });
});
const SymPoints = define_component<SymPointsProps>('SymPoints', props => {
  const { style, points } = split_samples(props);
  return new Points({ ...style, points });
});
const SymFill = define_component<SymFillProps>('SymFill', ({ upper = 1, lower = 0,
  xlim = [0, 1], xvals, ylim, yvals, samples = 101, ...props }) => {
  sample_count(samples);
  const horizontal = props.direction === 'horizontal', lim = horizontal ? ylim ?? xlim : xlim;
  const values = (horizontal ? yvals : xvals) ?? linspace(lim[0], lim[1], samples);
  const point = (value: number, fn: ScalarFunction) => finite_point(horizontal
    ? { x: scalar_value(fn, value), y: value } : { x: value, y: scalar_value(fn, value) });
  const points = values.map(value => point(value, upper));
  const boundary = values.map(value => point(value, lower));
  return new Fill({ ...props, points, boundary });
});

// Vector directions are mapped before head construction, so non-square graph
// frames orient arrows correctly while head dimensions remain fixed in pixels.
const Field = define_element<FieldData, FieldProps>('Field', (props, query) => {
  const { size, point, paint, length } = mark_context(props, query);
  const draw = [], children = [];
  for (const [index, vector] of props.vectors.entries()) {
    const a = point(vector.from), b = point(vector.to);
    if (vector.shape) {
      const width = Math.hypot(b.x - a.x, b.y - a.y), height = length(props.shape_height ?? px(8));
      const fragment = query.child(vector.shape, make_request({ width: exact(width), height: exact(height) }),
        { width, height }, index, { coordinates: null });
      const angle = Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(angle), s = Math.sin(angle);
      children.push(place_fragment(fragment, a, [c, s, -s, c, s * height / 2, -c * height / 2]));
    } else draw.push(...arrow_draw([a, b], paint, { ...paint, fill: paint.stroke, stroke: 'none' },
      length(props.head_size ?? px(5)), { head_width: props.head_width }));
  }
  return make_fragment({ size, draw, children });
}, {}, {
  normalize: ({ vectors = [], scale = 1, normalize = false, shape, ...props }) => {
    finite(scale, 'scale');
    return { ...props, vectors: vectors.flatMap((sample, index) => {
      const from = finite_point(sample.point), vector = finite_point(sample.vector);
      if (!from || !vector) return [];
      const norm = Math.hypot(vector.x, vector.y);
      if (!norm || !scale) return [];
      const factor = scale / (normalize ? norm : 1);
      const to = finite_point({ x: from.x + vector.x * factor, y: from.y + vector.y * factor });
      if (!to) return [];
      return [{ from, to, shape: typeof shape === 'function' ? shape(sample, index) : shape }];
    }) };
  },
  data_bounds: props => mark_bounds(props, props.vectors.flatMap(vector => [vector.from, vector.to])),
});

const SymField = define_component<SymFieldProps>('SymField', ({ f, xlim = [-1, 1], ylim = [-1, 1],
  xvals, yvals, samples = 11, ...props }) => {
  const counts = typeof samples === 'number' ? { x: samples, y: samples } : samples;
  sample_count(counts.x, 1000); sample_count(counts.y, 1000);
  const xs = xvals ?? linspace(xlim[0], xlim[1], counts.x);
  const ys = yvals ?? linspace(ylim[0], ylim[1], counts.y);
  sample_count(xs.length * ys.length, 100000);
  if (!f) return new Field({ ...props, vectors: [] });
  const vectors: VectorSample[] = [];
  for (const x of xs) for (const y of ys) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const vector = finite_point(f(x, y));
    if (vector) vectors.push({ point: make_point(x, y), vector });
  }
  return new Field({ ...props, vectors });
});

export { SymLine, SymSpline, SymPoly, SymPoints, SymFill, Field, SymField };
export type { SymLineProps, SymSplineProps, SymPointsProps, SymFillProps,
  VectorSample, FieldProps, SymFieldProps };
