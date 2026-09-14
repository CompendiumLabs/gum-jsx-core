import { d2r } from './constants';
import { read_point } from '../engine/geometry';
import type { Point, PointValue } from '../engine/geometry';

type NumericPair = readonly [number, number];
type Vector2 = PointValue;
type Complex = readonly [real: number, imaginary: number];

function pair(value: number | Vector2): NumericPair {
  if (typeof value === 'number') return [value, value];
  const { x, y } = read_point(value, '2D vector');
  return [x, y];
}
function pair_op(a: number | Vector2, b: number | Vector2, op: (a: number, b: number) => number): Point {
  const [ax, ay] = pair(a), [bx, by] = pair(b);
  return Object.freeze({ x: op(ax, bx), y: op(ay, by) });
}
const add2 = (a: number | Vector2, b: number | Vector2): Point => pair_op(a, b, (x, y) => x + y);
const sub2 = (a: number | Vector2, b: number | Vector2): Point => pair_op(a, b, (x, y) => x - y);
const mul2 = (a: number | Vector2, b: number | Vector2): Point => pair_op(a, b, (x, y) => x * y);
const div2 = (a: number | Vector2, b: number | Vector2): Point => pair_op(a, b, (x, y) => x / y);

function vector_op(a: readonly number[], b: readonly number[], op: (a: number, b: number) => number): readonly number[] {
  if (a.length !== b.length) throw new RangeError('vector lengths must match');
  return Object.freeze(a.map((value, i) => op(value, b[i])));
}
const addn = (a: readonly number[], b: readonly number[]): readonly number[] => vector_op(a, b, (x, y) => x + y);
const subn = (a: readonly number[], b: readonly number[]): readonly number[] => vector_op(a, b, (x, y) => x - y);
const muln = (a: readonly number[], b: readonly number[]): readonly number[] => vector_op(a, b, (x, y) => x * y);
const divn = (a: readonly number[], b: readonly number[]): readonly number[] => vector_op(a, b, (x, y) => x / y);

// Graphics helpers use native {x,y} points; complex values stay [real,imaginary].
function polar(theta: number, radius: number | Vector2 = 1, center: Vector2 = [0, 0]): Point {
  return add2(center, mul2(radius, [Math.cos(theta), Math.sin(theta)]));
}
function polard(angle: number, radius: number | Vector2 = 1, center: Vector2 = [0, 0]): Point {
  return polar(angle * d2r, radius, center);
}
function complex(value: number | Complex): Complex {
  if (typeof value === 'number') return [value, 0];
  if (value.length !== 2) throw new TypeError('a complex number needs [real, imaginary]');
  return value;
}
function addc(a: number | Complex, b: number | Complex): Complex {
  const [x, y] = complex(a), [u, v] = complex(b);
  return Object.freeze([x + u, y + v]);
}
function subc(a: number | Complex, b: number | Complex): Complex {
  const [x, y] = complex(a), [u, v] = complex(b);
  return Object.freeze([x - u, y - v]);
}
function mulc(a: number | Complex, b: number | Complex): Complex {
  const [x, y] = complex(a), [u, v] = complex(b);
  return Object.freeze([x * u - y * v, x * v + y * u]);
}
function divc(a: number | Complex, b: number | Complex): Complex {
  const [x, y] = complex(a), [u, v] = complex(b);
  const scale = Math.max(Math.abs(u), Math.abs(v)), c = u / scale, d = v / scale;
  const denominator = c * c + d * d;
  return Object.freeze([(x / scale * c + y / scale * d) / denominator,
    (y / scale * c - x / scale * d) / denominator]);
}
function conjc(value: number | Complex): Complex {
  const [x, y] = complex(value);
  return Object.freeze([x, -y]);
}
function normc(value: number | Complex): number { return Math.hypot(...complex(value)); }
function argc(value: number | Complex): number {
  const [x, y] = complex(value);
  return Math.atan2(y, x);
}

export { add2, sub2, mul2, div2, addn, subn, muln, divn, polar, polard,
  addc, subc, mulc, divc, conjc, normc, argc };
export type { NumericPair, Vector2, Complex };
