import type { Fragment } from './engine/fragment'
import type { Insets, Point } from './engine/geometry'
import { output_number_formatter } from './engine/output_number'
import type { OutputPrecision } from './engine/output_number'

type InspectOptions = Readonly<{ precision?: OutputPrecision }>

function insets_text(name: string, number: (value: number) => string, insets?: Insets): string {
  const entries = Object.entries(insets ?? {}).filter(([, value]) => value !== 0)
  const edges = entries.map(([side, value]) => `${side}:${number(value)}`).join(',')
  return entries.length ? ` ${name}=${edges}` : ''
}

// Inspect only result data: this command cannot evaluate or measure an element.
// Keep the library default exact; CLI tree output supplies its output precision.
function inspect_fragment(fragment: Fragment, options: InspectOptions = {}): string {
  const number = output_number_formatter(options.precision ?? 'full')
  const record = (value: object) => JSON.stringify(value, (_, item) =>
    typeof item === 'number' && Number.isFinite(item) ? Number(number(item)) : item)
  const lines: string[] = []
  function visit(node: Fragment, depth: number, offset: Point, matrix = ''): void {
    const { width, height } = node.size
    const name = node.name ?? 'Fragment'
    const location = `@(${number(offset.x)},${number(offset.y)})`
    const ink = node.ink === null ? 'none'
      : `${number(node.ink.x)},${number(node.ink.y)},${number(node.ink.width)},${number(node.ink.height)}`
    const guides = Object.entries(node.guides)
      .filter((entry): entry is [string, number] => entry[1] !== undefined)
      .map(([key, value]) => ` ${key}=${number(value)}`).join('')
    const math = node.math ? ` math=${record(node.math)}` : ''
    const content = node.content
    const box = content ? ` content=${number(content.x)},${number(content.y)},${number(content.width)},${number(content.height)}` : ''
    const connection = node.connection ? ` connection=${record(node.connection)}` : ''
    lines.push(`${'  '.repeat(depth)}${name} ${number(width)}×${number(height)} ${location}${matrix}`
      + ` ink=${ink}${insets_text('overflow', number, node.overflow)}${insets_text('outset', number, node.outset)}${guides}${math}${box}${connection}${node.clip ? ' clipped' : ''}`)
    for (const child of node.children) {
      const transform = child.transform ? ` matrix(${child.transform.map(number).join(',')})` : ''
      visit(child.fragment, depth + 1, child.offset, transform)
    }
  }
  visit(fragment, 0, { x: 0, y: 0 })
  return lines.join('\n')
}

export { inspect_fragment }
export type { InspectOptions }
