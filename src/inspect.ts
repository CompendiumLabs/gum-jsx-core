import type { Fragment } from './engine/fragment'
import type { Insets, Point } from './engine/geometry'

// Keep numerical layout output exact; inspection must not round away a boundary.
function insets_text(name: string, insets?: Insets): string {
  const entries = Object.entries(insets ?? {}).filter(([, value]) => value !== 0)
  const edges = entries.map(([side, value]) => `${side}:${value}`).join(',')
  return entries.length ? ` ${name}=${edges}` : ''
}

// Inspect only result data: this command cannot evaluate or measure an element.
function inspect_fragment(fragment: Fragment): string {
  const lines: string[] = []
  function visit(node: Fragment, depth: number, offset: Point, matrix = ''): void {
    const { width, height } = node.size
    const name = node.name ?? 'Fragment'
    const location = `@(${offset.x},${offset.y})`
    const ink = node.ink === null ? 'none'
      : `${node.ink.x},${node.ink.y},${node.ink.width},${node.ink.height}`
    const guides = Object.entries(node.guides).map(([key, value]) => ` ${key}=${value}`).join('')
    const math = node.math ? ` math=${JSON.stringify(node.math)}` : ''
    const content = node.content
    const box = content ? ` content=${content.x},${content.y},${content.width},${content.height}` : ''
    const connection = node.connection ? ` connection=${JSON.stringify(node.connection)}` : ''
    lines.push(`${'  '.repeat(depth)}${name} ${width}×${height} ${location}${matrix}`
      + ` ink=${ink}${insets_text('overflow', node.overflow)}${insets_text('outset', node.outset)}${guides}${math}${box}${connection}${node.clip ? ' clipped' : ''}`)
    for (const child of node.children) {
      const transform = child.transform ? ` matrix(${child.transform.join(',')})` : ''
      visit(child.fragment, depth + 1, child.offset, transform)
    }
  }
  visit(fragment, 0, { x: 0, y: 0 })
  return lines.join('\n')
}

export { inspect_fragment }
