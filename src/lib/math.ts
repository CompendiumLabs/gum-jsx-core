import { finite } from './checks'
import type { Limit } from '../engine/coordinates'

// Plain numeric functions keep JavaScript's NaN/Infinity behavior, allowing
// sampled functions to describe domain gaps without throwing during evaluation.
const { abs, acos, acosh, asin, asinh, atan, atanh, atan2, cbrt, ceil, clz32,
  cos, cosh, exp, expm1, floor, fround, hypot, imul, log, log10, log1p, log2,
  pow, round, sign, sin, sinh, sqrt, tan, tanh, trunc } = Math
const isNan = Number.isNaN
const isFinite = Number.isFinite
const isInf = (x: number): boolean => x === Infinity || x === -Infinity
const cot = (x: number): number => 1 / tan(x)
const heaviside = (x: number): number => x >= 0 ? 1 : 0
const heavisign = (x: number): number => x >= 0 ? 1 : -1
const abs_min = (x: number, y: number): number => abs(x) < abs(y) ? x : y
const abs_max = (x: number, y: number): number => abs(x) > abs(y) ? x : y
const identity = <T>(x: T): T => x
const invert = (x: number | undefined): number | undefined => x === undefined ? undefined : 1 / x

type NumberValues = readonly (number | null | undefined)[]

function sum(values: NumberValues): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0)
}
function prod(values: NumberValues): number {
  return values.reduce<number>((total, value) => total * (value ?? 1), 1)
}
function mean(values: NumberValues): number {
  let total = 0, count = 0
  for (const value of values) if (value != null) { total += value; count++; }
  return total / count
}
function min(values: NumberValues): number | undefined {
  let result: number | undefined
  for (const value of values) if (value != null) result = result === undefined ? value : Math.min(result, value)
  return result
}
function max(values: NumberValues): number | undefined {
  let result: number | undefined
  for (const value of values) if (value != null) result = result === undefined ? value : Math.max(result, value)
  return result
}
const minimum = (...values: (number | null | undefined)[]): number | undefined => min(values)
const maximum = (...values: (number | null | undefined)[]): number | undefined => max(values)
const all = (values: readonly boolean[]): boolean => values.every(Boolean)
const any = (values: readonly boolean[]): boolean => values.some(Boolean)

function cumsum(values: readonly number[], first = true): readonly number[] {
  let total = 0
  const result = values.map(value => total += value)
  return Object.freeze(first ? [0, ...result] : result)
}

function norm_degree(degree: number): void {
  if (!(degree > 0)) throw new RangeError('norm degree must be positive')
}
function norm(values: readonly number[], degree = 2): number {
  norm_degree(degree)
  const scale = values.reduce((n, value) => Math.max(n, abs(value)), 0)
  if (scale === 0 || !Number.isFinite(scale) || degree === Infinity) return scale
  return scale * sum(values.map(value => (abs(value) / scale) ** degree)) ** (1 / degree)
}
function normalize(values: readonly number[], degree = 1): readonly number[] {
  norm_degree(degree)
  const scale = values.reduce((n, value) => Math.max(n, abs(value)), 0)
  if (scale === 0) return Object.freeze(values.map(() => 0))
  const scaled = values.map(value => value / scale), magnitude = norm(scaled, degree)
  return Object.freeze(scaled.map(value => value / magnitude))
}

function numeric_limit(lim: Limit, distinct: boolean): void {
  if (lim.length !== 2) throw new TypeError('limit must contain two numbers')
  finite(lim[0], 'limit start'); finite(lim[1], 'limit end')
  if (distinct && lim[0] === lim[1]) throw new RangeError('limit endpoints must differ')
}
function clamp(x: number, lim: Limit = [0, 1]): number {
  numeric_limit(lim, false)
  return Math.max(Math.min(...lim), Math.min(x, Math.max(...lim)))
}
function rescale(x: number, lim: Limit = [0, 1]): number {
  numeric_limit(lim, true)
  const [a, b] = lim
  // Opposite large finite endpoints can overflow their difference.
  return Number.isFinite(b - a) && Number.isFinite(x - a)
    ? (x - a) / (b - a) : (x / 2 - a / 2) / (b / 2 - a / 2)
}
function lerp(a: number, b: number, t: number): number {
  if (t === 0) return a
  if (t === 1) return b
  return Number.isFinite(b - a) ? a + (b - a) * t : a * (1 - t) + b * t
}
const sigmoid = (x: number): number => 1 / (1 + exp(-x))
const logit = (p: number): number => log(p / (1 - p))
function smoothstep(x: number, lim: Limit = [0, 1]): number {
  const t = clamp(rescale(x, lim))
  return t * t * (3 - 2 * t)
}

// Compact decimal labels, with the original string/px-string convenience.
function rounder(value: number | string, precision = 2): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 100) {
    throw new RangeError('precision must be an integer from 0 to 100')
  }
  if (typeof value === 'string' && !value.endsWith('px')) return value
  const suffix = typeof value === 'string' ? 'px' : ''
  const number = typeof value === 'string' ? Number(value.slice(0, -2)) : value
  const text = number.toFixed(precision).replace(/(\.[0-9]*?)0+$/, '$1').replace(/\.$/, '')
  return (text === '-0' ? '0' : text) + suffix
}

export { abs, acos, acosh, asin, asinh, atan, atanh, atan2, cbrt, ceil, clz32, cos, cosh,
  exp, expm1, floor, fround, hypot, imul, log, log10, log1p, log2, pow, round, sign,
  sin, sinh, sqrt, tan, tanh, trunc, cot, isNan, isInf, isFinite,
  heaviside, heavisign, abs_min, abs_max, identity, invert,
  sum, prod, mean, min, max, minimum, maximum, all, any, cumsum, norm, normalize,
  clamp, rescale, lerp, sigmoid, logit, smoothstep, rounder }
export type { NumberValues }
