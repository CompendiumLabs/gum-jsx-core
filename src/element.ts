import type { Fragment } from './fragment';
import type { FlexSpec } from './flex';
import type { PositionSpec } from './group';
import type { SizeSpec } from './layout';
import type { LayoutQuery } from './pass';
import type { StyleSpec } from './style';
import type { DataBounds } from './coordinates';

type Child = Element | string | number | boolean | null | undefined | readonly Child[];
type ElementProps = SizeSpec & StyleSpec & FlexSpec & PositionSpec & Readonly<{ children?: Child }>;
type LayoutMethod<Props> = (props: Readonly<Props>, query: LayoutQuery) => Fragment;
type ElementType = Readonly<{
  name: string;
  layout: (element: Element, query: LayoutQuery) => Fragment;
  // Graph containers inspect source geometry without measuring or cloning it.
  data_bounds?: (element: Element) => DataBounds | null;
}>;
type ElementOptions<Props, Input> = Readonly<{
  normalize?: (props: Input) => Props;
  data_bounds?: (props: Readonly<Props>) => DataBounds | null;
}>;

// Snapshot source data while preserving immutable element identities in the DAG.
function copy_data<T>(value: T, active = new Set<object>()): T {
  if (value instanceof Element) return value;
  if (typeof value === 'function') {
    throw new TypeError('Define behavior on the element type; source data cannot contain functions');
  }
  if (value === null || typeof value !== 'object') return value;
  if (active.has(value)) throw new TypeError('Source data contains a cycle');

  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError('Source data must be records or arrays; keep resources in LayoutPass');
  }
  active.add(value);
  const result = Array.isArray(value)
    ? value.map(item => copy_data(item, active))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy_data(item, active)]));
  active.delete(value);
  return Object.freeze(result) as T;
}

// Snapshot optional defaults once; each instance overrides them with its own data.
// Construction never measures and leaves parent-readable metadata in source props.
function define_element<Props extends ElementProps = ElementProps, Input extends ElementProps = Props>(
  name: string, layout: LayoutMethod<Props>, defaults: Partial<Props> = {},
  options: ElementOptions<Props, Input> = {},
) {
  const preset = copy_data(defaults);
  const type: ElementType = Object.freeze({
    name,
    layout: (element, query) => layout(element.props as Readonly<Props>, query),
    ...(options.data_bounds ? {
      data_bounds: (element: Element) => options.data_bounds!(element.props as Readonly<Props>),
    } : {}),
  });
  return class extends Element<Props> {
    constructor(props: Input = {} as Input) {
      // Sampling and component expansion happen once, before immutable ownership.
      // No callbacks or mutable external state survive in the source description.
      super(type, { ...preset, ...(options.normalize ? options.normalize(props) : props) } as Props);
    }
  };
}

// A named construction-time component adopts an existing element's protocol and
// immutable description. It introduces neither a layout wrapper nor callbacks.
function define_component<Input extends ElementProps>(name: string, build: (props: Input) => Element) {
  return class extends Element {
    constructor(props: Input = {} as Input) {
      const source = build(props);
      super({ ...source.type, name }, source.props);
    }
  };
}

// JSX fragments and conditional children flatten without acquiring layout policy.
// Inline JSX spaces survive parsing for Text/Span; element-only containers ignore
// blank strings along with null and boolean children. Nonbreaking spaces are text.
function element_children(child: Child = []): readonly Element[] {
  const items: readonly Child[] = Array.isArray(child) ? child : [child];
  const result: Element[] = [];
  for (const item of items) {
    if (item === null || item === undefined || typeof item === 'boolean') continue;
    if (typeof item === 'string' && /^[ \t\r\n]*$/.test(item)) continue;
    if (Array.isArray(item)) result.push(...element_children(item));
    else if (item instanceof Element) result.push(item);
    else throw new TypeError('Expected an element child');
  }
  return Object.freeze(result);
}

// Single-content containers share one validation rule, including conditional children.
function content_child(child: Child = []): Element | undefined {
  const children = element_children(child);
  if (children.length > 1) throw new TypeError('Expected one content element');
  return children[0];
}

class Element<Props extends ElementProps = ElementProps> {
  readonly type: ElementType;
  readonly props: Readonly<Props>;

  // Descriptions own their source data; all evaluation state belongs to a pass.
  constructor(type: ElementType, props: Props) {
    this.type = Object.freeze({ ...type });
    this.props = copy_data(props);
    Object.freeze(this);
  }
}

export { Element, define_element, define_component, element_children, content_child, copy_data };
export type { Child, ElementProps, ElementType, LayoutMethod, ElementOptions };
