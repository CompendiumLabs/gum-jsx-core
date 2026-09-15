import type { ElementProps } from '../engine/element'
import { finite, nonnegative } from '../lib/checks'
import { Element } from '../engine/element'
import { draw_rect } from '../engine/drawing'
import { make_fragment } from '../engine/fragment'
import { make_point, make_rect } from '../engine/geometry'
import { mark_context, mark_bounds } from './marks'
import { resolve_rect_radius } from './shapes'
import type { RectRadius } from './shapes'
import type { MarkProps } from './marks'
import type { LayoutQuery } from '../engine/pass'
import { resolve_paint, resolve_style } from '../engine/style'
import type { StyleSpec } from '../engine/style'

type PerBar<T> = T | readonly T[] | ((value: number, index: number) => T)
type BarStyle = StyleSpec & Readonly<{ radius?: RectRadius }>
type BarsProps = MarkProps & Readonly<{
  values?: readonly number[]; positions?: readonly number[]
  bases?: PerBar<number>; bar_width?: PerBar<number>
  direction?: 'vertical' | 'horizontal'; radius?: RectRadius
  styles?: readonly BarStyle[] | ((value: number, index: number) => BarStyle)
}>
type BarProps = Omit<BarsProps, 'values' | 'positions' | 'bases' | 'bar_width' | 'styles'> & Readonly<{
  value?: number; position?: number; base?: number; bar_width?: number
}>
type BarDatum = Readonly<{ value: number; position: number; base: number; width: number; style: BarStyle }>
type BarsData = MarkProps & Readonly<{
  bars: readonly BarDatum[]; direction?: 'vertical' | 'horizontal'; radius?: RectRadius
}>

function bars_data({ values = [], positions, bases = 0, bar_width = 0.8, styles, ...props }: BarsProps): BarsData {
  if (positions && positions.length !== values.length) throw new RangeError('Bar positions must match values')
  for (const [name, value] of Object.entries({ bases, bar_width, styles })) {
    if (Array.isArray(value) && value.length !== values.length) throw new RangeError(`${name} must match values`)
  }
  const get = <T>(source: PerBar<T>, value: number, index: number): T => typeof source === 'function'
    ? (source as (value: number, index: number) => T)(value, index)
    : Array.isArray(source) ? source[index] : source as T
  const bars = values.flatMap((value, index) => {
    // Missing values omit a bar without shifting the remaining category positions.
    if (!Number.isFinite(value)) return []
    const position = finite(positions?.[index] ?? index, 'bar position')
    const base = finite(get(bases, value, index), 'bar base')
    const width = nonnegative(get(bar_width, value, index), 'bar_width')
    const style = styles ? get(styles, value, index) : {}
    return [{ value, position, base, width, style }]
  })
  return { ...props, bars }
}

function bar_corners(bar: BarDatum, direction = 'vertical') {
  if (!['vertical', 'horizontal'].includes(direction)) throw new TypeError('Unknown bar direction')
  const { value, position, base, width } = bar
  return direction === 'vertical'
    ? [make_point(position - width / 2, base), make_point(position + width / 2, value)]
    : [make_point(base, position - width / 2), make_point(value, position + width / 2)]
}

function bars_layout(props: BarsData, query: LayoutQuery) {
  const { size, point } = mark_context(props, query)
  const shared_radius = resolve_rect_radius(props.radius ?? 0, size, query)
  const draw = props.bars.map(bar => {
    const [a, b] = bar_corners(bar, props.direction).map(point)
    const rect = make_rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    const style = resolve_style(bar.style, query.style)
    const paint = resolve_paint(style, size, query.path)
    // Radius is geometry, so it must be consumed separately from inherited paint.
    const radius = bar.style.radius === undefined ? shared_radius
      : resolve_rect_radius(bar.style.radius, size, { ...query, style })
    return draw_rect(rect, paint, radius)
  })
  return make_fragment({ size, draw })
}

class Bars extends Element<BarsData, BarsProps> {
  static defaults: Partial<BarsData> = { fill: 'theme:accent', stroke: 'none' }
  static normalize = bars_data
  static data_bounds(props: BarsData) {
    return mark_bounds(props, props.bars.flatMap(bar => bar_corners(bar, props.direction)))
  }
  static layout = bars_layout
}

class VBars extends Bars {
  static defaults: Partial<BarsData> = { direction: 'vertical' }
}

class HBars extends Bars {
  static defaults: Partial<BarsData> = { direction: 'horizontal' }
}
class Bar extends Element<BarsData, BarProps> {
  static defaults = Bars.defaults
  static data_bounds = Bars.data_bounds
  static normalize({ value = 1, position = 0, base = 0, bar_width = 0.8, ...props }: BarProps): BarsData {
    return bars_data({ ...props, values: [value], positions: [position], bases: base, bar_width })
  }
  static layout = bars_layout
}

class VBar extends Bar {
  static defaults: Partial<BarsData> = { direction: 'vertical' }
}

class HBar extends Bar {
  static defaults: Partial<BarsData> = { direction: 'horizontal' }
}

export { Bar, VBar, HBar, Bars, VBars, HBars }
export type { PerBar, BarStyle, BarProps, BarsProps }
