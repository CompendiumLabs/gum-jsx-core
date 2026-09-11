import type { Fragment } from './fragment';
import type { FlexSpec } from './flex';
import type { SizeSpec } from './layout';
import type { LayoutQuery } from './pass';
import type { StyleSpec } from './style';

type Child = Element | string | number | boolean | null | undefined | readonly Child[];
type ElementProps = SizeSpec & StyleSpec & FlexSpec & Readonly<{ children?: Child }>;
type LayoutMethod<Props> = (props: Readonly<Props>, query: LayoutQuery) => Fragment;
type ElementType = Readonly<{
  name: string;
  layout: (element: Element, query: LayoutQuery) => Fragment;
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
function define_element<Props extends ElementProps = ElementProps>(
  name: string, layout: LayoutMethod<Props>, defaults: Partial<Props> = {},
) {
  const preset = copy_data(defaults);
  const type: ElementType = Object.freeze({
    name,
    layout: (element, query) => layout(element.props as Readonly<Props>, query),
  });
  return class extends Element<Props> {
    constructor(props: Props = {} as Props) {
      super(type, { ...preset, ...props });
    }
  };
}

// JSX fragments and conditional children flatten without acquiring layout policy.
function element_children(child: Child = []): readonly Element[] {
  const items: readonly Child[] = Array.isArray(child) ? child : [child];
  const result: Element[] = [];
  for (const item of items) {
    if (item === null || item === undefined || typeof item === 'boolean') continue;
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

export { Element, define_element, element_children, content_child, copy_data };
export type { Child, ElementProps, ElementType, LayoutMethod };
