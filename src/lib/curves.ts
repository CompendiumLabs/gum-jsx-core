import { finite, nonnegative } from './checks';
import { make_point, read_point } from '../engine/geometry';
import type { Point, PointValue } from '../engine/geometry';
import type { PathCommand } from '../engine/path';

// Uniform Catmull–Rom tangents expressed as cubic Bezier commands. Endpoints use
// one-sided tangents; repeated points and singletons require no division.
function spline_path(values: readonly PointValue[], tension = 1, closed = false): PathCommand[] {
  const points = values.map(value => read_point(value));
  nonnegative(tension, 'tension');
  if (!points.length) return [];
  const path: PathCommand[] = [{ kind: 'M', ...points[0] }];
  const count = points.length;
  const at = (i: number) => points[closed ? (i + count) % count : Math.max(0, Math.min(count - 1, i))];
  for (let i = 0; i < count - (closed ? 0 : 1); i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    path.push({ kind: 'C', x1: b.x + (c.x - a.x) * tension / 6,
      y1: b.y + (c.y - a.y) * tension / 6,
      x2: c.x - (d.x - b.x) * tension / 6, y2: c.y - (d.y - b.y) * tension / 6, ...c });
  }
  if (closed && count > 1) path.push({ kind: 'Z' });
  return path;
}

// Corner trimming is in final pixels, keeping the requested rounding stable on resize.
function rounded_path(values: readonly PointValue[], radius: number): PathCommand[] {
  const points = values.map(value => read_point(value));
  nonnegative(radius, 'radius');
  if (!points.length) return [];
  const path: PathCommand[] = [{ kind: 'M', ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, ab / 2, bc / 2);
    if (!r) { path.push({ kind: 'L', ...b }); continue; }
    const before = make_point(b.x + (a.x - b.x) * r / ab, b.y + (a.y - b.y) * r / ab);
    const after = make_point(b.x + (c.x - b.x) * r / bc, b.y + (c.y - b.y) * r / bc);
    path.push({ kind: 'L', ...before }, { kind: 'Q', x1: b.x, y1: b.y, ...after });
  }
  if (points.length > 1) path.push({ kind: 'L', ...points[points.length - 1] });
  return path;
}

// Elliptic arcs use cubic pieces of at most a quarter turn. Angles are degrees
// in drawing coordinates (positive clockwise); radii may carry a flipped axis.
function arc_path(center_value: PointValue, radius_value: PointValue, start = 0, end = 360): PathCommand[] {
  const center = read_point(center_value, 'center'), radius = read_point(radius_value, 'radius');
  finite(start, 'start'); finite(end, 'end');
  if (Math.abs(end - start) > 360) throw new RangeError('An arc spans at most 360 degrees');
  const radians = Math.PI / 180;
  const at = (a: number) => make_point(center.x + radius.x * Math.cos(a), center.y + radius.y * Math.sin(a));
  let angle = start * radians;
  const path: PathCommand[] = [{ kind: 'M', ...at(angle) }];
  const count = Math.ceil(Math.abs(end - start) / 90);
  const step = (end - start) * radians / count;
  for (let i = 0; i < count; i++) {
    const next = angle + step, k = 4 / 3 * Math.tan(step / 4);
    const a = at(angle), b = at(next);
    path.push({ kind: 'C', x1: a.x - k * radius.x * Math.sin(angle),
      y1: a.y + k * radius.y * Math.cos(angle),
      x2: b.x + k * radius.x * Math.sin(next), y2: b.y - k * radius.y * Math.cos(next), ...b });
    angle = next;
  }
  return path;
}

// Evaluate a uniform spline on t in [0,1]. This helper owns a copy of its inputs.
function spline2d(points: readonly PointValue[], tension = 1): (t: number) => Point {
  if (!points.length) throw new RangeError('spline2d needs at least one point');
  const start = read_point(points[0]);
  const first = make_point(start.x, start.y);
  const commands = spline_path(points, tension).filter(command => command.kind === 'C');
  return (t: number) => {
    finite(t, 't');
    if (!commands.length) return first;
    const value = Math.max(0, Math.min(1, t)) * commands.length;
    const index = Math.min(commands.length - 1, Math.floor(value)), u = value - index, v = 1 - u;
    const a = index ? commands[index - 1] : first, b = commands[index];
    return make_point(v ** 3 * a.x + 3 * v ** 2 * u * b.x1 + 3 * v * u ** 2 * b.x2 + u ** 3 * b.x,
      v ** 3 * a.y + 3 * v ** 2 * u * b.y1 + 3 * v * u ** 2 * b.y2 + u ** 3 * b.y);
  };
}

function spline1d(values: readonly number[], tension = 1): (t: number) => number {
  const sample = spline2d(values.map((y, x) => make_point(x, y)), tension);
  return t => sample(t).y;
}

export { spline_path, rounded_path, arc_path, spline1d, spline2d };
