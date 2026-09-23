import type { Fragment } from './fragment'
import type { FlexSpec } from '../lib/flex'
import type { PositionSpec } from '../elems/group'
import type { SizeSpec } from './layout'
import type { FitSpec } from './fitting'
import type { Alignment } from '../lib/composition'
import type { LayoutQuery } from './pass'
import type { StyleSpec } from './style'
import type { DataBounds } from './coordinates'

type Child = Element | string | number | boolean | null | undefined | readonly Child[]
type ElementProps = SizeSpec & FitSpec & StyleSpec & FlexSpec & PositionSpec & Readonly<{
  children?: Child
  // Any identified element is a connection target for the enclosing Network.
  id?: string
  // Outline this element's allocated and content boxes without inheriting to children.
  debug?: boolean
  // Override the immediate container's alignment; stacks use the cross axis.
  align_self?: Alignment | 'baseline'
}>
type LayoutMethod<Props> = (props: Readonly<Props>, query: LayoutQuery) => Fragment
type ElementType = Readonly<{
  name: string
  layout: (element: Element, query: LayoutQuery) => Fragment
  // Intrinsic sources fit ordinary layout offers, but not internal math allocations.
  auto_fit?: boolean
  // Graph containers inspect source geometry without measuring or cloning it.
  data_bounds?: (element: Element) => DataBounds | null
}>
type ElementOptions<Props, Input> = Readonly<{
  auto_fit?: boolean
  normalize?: (props: Input) => Props
  data_bounds?: (props: Readonly<Props>) => DataBounds | null
}>

// Snapshot source data while preserving immutable element identities in the DAG.
function copy_data<T>(value: T, active = new Set<object>()): T {
  if (value instanceof Element) return value
  if (typeof value === 'function') {
    throw new TypeError('Define behavior on the element type; source data cannot contain functions')
  }
  if (value === null || typeof value !== 'object') return value
  if (active.has(value)) throw new TypeError('Source data contains a cycle')

  const proto = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError('Source data must be records or arrays; keep resources in LayoutPass')
  }
  active.add(value)
  const result = Array.isArray(value)
    ? value.map(item => copy_data(item, active))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy_data(item, active)]))
  active.delete(value)
  return Object.freeze(result) as T
}

// Snapshot optional defaults once; each instance overrides them with its own data.
// Construction never measures and leaves parent-readable metadata in source props.
function define_element<Props extends ElementProps = ElementProps, Input extends ElementProps = Props>(
  name: string, layout: LayoutMethod<Props>, defaults: Partial<Props> = {},
  options: ElementOptions<Props, Input> = {},
) {
  const preset = copy_data(defaults)
  return class extends Element<Props, Input> {
    static element_name = name
    static defaults = preset
    static layout = layout
    static normalize = options.normalize
    static data_bounds = options.data_bounds
    static auto_fit = options.auto_fit
  }
}

// A named construction-time component adopts an existing element's protocol and
// immutable description. It introduces neither a layout wrapper nor callbacks.
function define_component<Input extends ElementProps>(name: string, build: (props: Input) => Element) {
  return class extends Element {
    constructor(props: Input = {} as Input) {
      const source = build(props)
      super({ ...source.type, name }, source.props)
    }
  }
}

// JSX fragments and conditional children flatten without acquiring layout policy.
// Inline JSX spaces survive parsing for Text/Span; element-only containers ignore
// blank strings along with null and boolean children. Nonbreaking spaces are text.
function element_children(child: Child = []): readonly Element[] {
  const items: readonly Child[] = Array.isArray(child) ? child : [child]
  const result: Element[] = []
  for (const item of items) {
    if (item === null || item === undefined || typeof item === 'boolean') continue
    if (typeof item === 'string' && /^[ \t\r\n]*$/.test(item)) continue
    if (Array.isArray(item)) result.push(...element_children(item))
    else if (item instanceof Element) result.push(item)
    else throw new TypeError('Expected an element child')
  }
  return Object.freeze(result)
}

// Single-content containers share one validation rule, including conditional children.
function content_child(child: Child = []): Element | undefined {
  const children = element_children(child)
  if (children.length > 1) throw new TypeError('Expected one content element')
  return children[0]
}

// Static hooks are captured once per class. A type descriptor operates on props,
// so components can adopt it without retaining the source element's prototype.
type ElementClass = Function & ElementOptions<ElementProps, ElementProps> & Readonly<{
  element_name?: string
  defaults?: Partial<ElementProps>
  layout?: LayoutMethod<ElementProps>
}>
type ElementDefinition = Readonly<{
  defaults: Readonly<ElementProps>
  type?: ElementType
  normalize?: (props: ElementProps) => ElementProps
}>
const definitions = new WeakMap<Function, ElementDefinition>()

function element_definition(ctor: ElementClass): ElementDefinition {
  const existing = definitions.get(ctor)
  if (existing) return existing
  const parent = Object.getPrototypeOf(ctor)
  const inherited = parent === Element || parent.prototype instanceof Element
    ? element_definition(parent).defaults : {}
  const defaults = copy_data({ ...inherited, ...(Object.hasOwn(ctor, 'defaults') ? ctor.defaults : {}) })
  const { layout, normalize, data_bounds, auto_fit } = ctor
  const name = Object.hasOwn(ctor, 'element_name') ? ctor.element_name! : ctor.name
  if (typeof name !== 'string' || !name) throw new TypeError('Element name must be a nonempty string')
  if (auto_fit !== undefined && typeof auto_fit !== 'boolean') throw new TypeError(`${name}.auto_fit must be a boolean`)
  for (const [key, hook] of Object.entries({ layout, normalize, data_bounds })) {
    if (hook !== undefined && typeof hook !== 'function') throw new TypeError(`${name}.${key} must be a function`)
  }
  const type: ElementType | undefined = layout && Object.freeze({
    name,
    layout: (element: Element, query: LayoutQuery) => layout.call(ctor, element.props, query),
    ...(auto_fit === undefined ? {} : { auto_fit }),
    ...(data_bounds ? { data_bounds: (element: Element) => data_bounds.call(ctor, element.props) } : {}),
  })
  const definition = Object.freeze({ defaults, type, normalize: normalize?.bind(ctor) })
  definitions.set(ctor, definition)
  return definition
}

class Element<Props extends ElementProps = ElementProps, Input extends ElementProps = Props> {
  readonly type: ElementType
  readonly props: Readonly<Props>

  // Descriptions own their source data; all evaluation state belongs to a pass.
  constructor(...args: [props?: Input] | [type: ElementType, props: Props]) {
    if (args.length === 2) {
      // Explicit descriptors remain available for protocol adoption and low-level callers.
      this.type = Object.freeze({ ...args[0] })
      this.props = copy_data(args[1])
    } else {
      const definition = element_definition(new.target as unknown as ElementClass)
      if (!definition.type) throw new TypeError(`${new.target.name} must define static layout(props, query)`)
      this.type = definition.type
      // Normalize raw input once, then apply source defaults, just like define_element.
      const input = args[0] === undefined ? {} as Input : args[0]
      const source = definition.normalize ? definition.normalize(input) : input
      this.props = copy_data({ ...definition.defaults, ...source } as Props)
    }
    const { id } = this.props
    if (id !== undefined && (typeof id !== 'string' || !id.length)) {
      throw new TypeError('An element id must be a nonempty string')
    }
    Object.freeze(this)
  }
}

export { Element, define_element, define_component, element_children, content_child, copy_data }
export type { Child, ElementProps, ElementType, LayoutMethod, ElementOptions }
