import { finite, nonnegative } from '../lib/checks'

// Passive layout data. The math package interprets these records; core only
// owns, validates, and transports them alongside ordinary layout geometry.
type MathSizeStyle = 'display' | 'text' | 'script' | 'scriptscript'
type MathStyle = MathSizeStyle | `${MathSizeStyle}-cramped`
type MathClass = 'mord' | 'mop' | 'mbin' | 'mrel' | 'mopen' | 'mclose' | 'mpunct' | 'minner' | 'none'
type MathContext = Readonly<{ style: MathStyle; size: number }>
type MathMetrics = Readonly<{
  advance: number
  left: MathClass
  right: MathClass
  italic: number
  skew: number
  nucleus?: 'character'
  limits?: 'auto' | 'always' | 'never'
}>

const classes = new Set<MathClass>(['mord', 'mop', 'mbin', 'mrel', 'mopen', 'mclose', 'mpunct', 'minner', 'none'])

function copy_math_context(context: MathContext): MathContext {
  if (typeof context.style !== 'string' || !/^(display|text|script|scriptscript)(-cramped)?$/.test(context.style)) {
    throw new TypeError('Unknown math style')
  }
  const size = finite(context.size, 'math size')
  if (size <= 0) throw new RangeError('Math size multiplier must be positive')
  return Object.freeze({ style: context.style, size })
}

function copy_math_metrics(metrics: MathMetrics): MathMetrics {
  const { left, right, nucleus, limits } = metrics
  if (!classes.has(left) || !classes.has(right)) throw new TypeError('Unknown math atom class')
  if (nucleus !== undefined && nucleus !== 'character') throw new TypeError('Unknown math nucleus')
  if (limits !== undefined && !['auto', 'always', 'never'].includes(limits)) throw new TypeError('Unknown math limits policy')
  return Object.freeze({
    advance: finite(metrics.advance, 'math advance'), left, right,
    italic: nonnegative(metrics.italic, 'italic correction'), skew: finite(metrics.skew, 'accent skew'),
    ...(nucleus === undefined ? {} : { nucleus }), ...(limits === undefined ? {} : { limits }),
  })
}

export { copy_math_context, copy_math_metrics }
export type { MathSizeStyle, MathStyle, MathClass, MathContext, MathMetrics }
