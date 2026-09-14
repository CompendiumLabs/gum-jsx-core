import { nonnegative } from '../lib/checks';
import { Element } from './element';
import { Fonts } from './fonts';
import { make_fragment } from './fragment';
import type { Fragment } from './fragment';
import { finish_size, make_request, prepare_request, resolve_sizing } from './layout';
import type { LayoutRequest, Sizing } from './layout';
import { resolve_style } from './style';
import type { Style } from './style';
import { UnresolvedLengthError } from './units';
import type { ReferenceBox } from './units';
import { copy_coordinates } from './coordinates';
import type { Coordinates } from './coordinates';

type LayoutContext = Readonly<{
  style?: Style; reference?: ReferenceBox; path?: string; coordinates?: Coordinates | null;
}>;
type Resource = Readonly<{ value: unknown; version: string | number }>;
type LayoutQuery = Readonly<{
  request: LayoutRequest;
  sizing: Sizing;
  style: Style;
  reference: ReferenceBox;
  path: string;
  coordinates?: Coordinates;
  child: (
    element: Element, request: LayoutRequest, reference?: ReferenceBox, index?: number,
    context?: Pick<LayoutContext, 'coordinates' | 'style'>,
  ) => Fragment;
  resource: <T>(name: string) => T;
  prepare: <T>(name: string, compute: () => T) => T;
}>;

// References describe established boxes, not offers. Missing axes stay missing.
function copy_reference(reference: ReferenceBox = {}): ReferenceBox {
  const result: { width?: number; height?: number } = {};
  for (const axis of ['width', 'height'] as const) {
    const value = reference[axis];
    if (value !== undefined) result[axis] = nonnegative(value, `reference.${axis}`);
  }
  return Object.freeze(result);
}

// Cache exactly the inputs visible to geometry. Diagnostic paths are not geometry.
function query_key(
  request: LayoutRequest, style: Style, reference: ReferenceBox, epoch: number,
  coordinates?: Coordinates,
): string {
  return JSON.stringify([request, style, reference.width, reference.height, epoch, coordinates]);
}

class LayoutError extends Error {
  readonly path: string;

  // Preserve the original failure while identifying its element instance in the tree.
  constructor(path: string, cause: unknown) {
    super(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'LayoutError';
    this.path = path;
  }
}

class LayoutPass {
  #cache = new WeakMap<Element, Map<string, Fragment>>();
  #prepared = new WeakMap<Element, Map<string, unknown>>();
  #active = new WeakMap<Element, Set<string>>();
  #resources = new Map<string, Resource>();
  #epoch = 0;
  #queries = 0;
  #layouts = 0;
  #hits = 0;

  // Resources and cache lifetimes belong to this pass, never to source elements.
  constructor(resources: Readonly<Record<string, Resource>> = {}) {
    if (!resources.fonts) this.set_resource('fonts', new Fonts(), 0);
    for (const [name, resource] of Object.entries(resources)) {
      this.set_resource(name, resource.value, resource.version);
    }
  }

  // Version changes conservatively invalidate the whole pass until finer reuse is useful.
  set_resource(name: string, value: unknown, version: string | number): void {
    const old = this.#resources.get(name);
    if (old && old.value === value && old.version === version) return;
    this.#resources.set(name, Object.freeze({ value, version }));
    this.#epoch++;
    this.#cache = new WeakMap();
    this.#prepared = new WeakMap();
  }

  // Resource access occurs during measurement; the renderer needs no resources.
  resource<T>(name: string): T {
    const resource = this.#resources.get(name);
    if (!resource) throw new Error(`Missing layout resource: ${name}`);
    return resource.value as T;
  }

  // Counters make repeated queries and reuse observable without changing results.
  get stats() {
    return Object.freeze({ queries: this.#queries, layouts: this.#layouts, hits: this.#hits });
  }

  // Natural queries and final allocations run the same element implementation.
  layout(element: Element, request = make_request(), context: LayoutContext = {}): Fragment {
    if (!(element instanceof Element)) throw new TypeError('Layout requires a next Element');
    const path = context.path ?? element.type.name;
    this.#queries++;

    try {
      request = make_request(request);
      const reference = copy_reference(context.reference);
      const style = resolve_style(element.props, context.style, path);
      const coordinates = context.coordinates ? copy_coordinates(context.coordinates) : undefined;
      const key = query_key(request, style, reference, this.#epoch, coordinates);
      const cache = this.#cache.get(element) ?? new Map<string, Fragment>();
      this.#cache.set(element, cache);
      const cached = cache.get(key);
      if (cached) {
        this.#hits++;
        return cached;
      }

      // Detect recursive requests without caching failures or poisoning later queries.
      const active = this.#active.get(element) ?? new Set<string>();
      this.#active.set(element, active);
      if (active.has(key)) throw new Error('Recursive layout request');
      active.add(key);
      try {
        const basis = { font_size: style.font_size, reference, path };
        const sizing = resolve_sizing(element.props, basis);
        const prepared = prepare_request(request, sizing);
        const query: LayoutQuery = Object.freeze({
          request: prepared, sizing, style, reference, path, coordinates,
          child: (child, offer, basis = {}, index = 0, context = {}) => this.layout(child, offer, {
            style, coordinates, ...context, reference: basis, path: `${path}/${child.type.name}[${index}]`,
          }),
          resource: <T>(name: string) => this.resource<T>(name),
          // Prepared content depends on source, style, and resources, never offers
          // or percentage references. Failed preparations are not retained.
          prepare: <T>(name: string, compute: () => T): T => {
            const cache = this.#prepared.get(element) ?? new Map<string, unknown>();
            this.#prepared.set(element, cache);
            const key = JSON.stringify([name, style, this.#epoch]);
            if (!cache.has(key)) cache.set(key, compute());
            return cache.get(key) as T;
          },
        });

        this.#layouts++;
        const result = element.type.layout(element, query);
        const size = finish_size(result.size, prepared, sizing);
        if (size.width !== result.size.width || size.height !== result.size.height) {
          throw new Error('Element returned a size outside its sizing policy; use finish_size');
        }
        const fragment = make_fragment({ ...result, name: element.type.name });
        cache.set(key, fragment);
        return fragment;
      } finally {
        active.delete(key);
      }
    } catch (error) {
      if (error instanceof LayoutError || error instanceof UnresolvedLengthError) throw error;
      throw new LayoutError(path, error);
    }
  }
}

export { LayoutPass, LayoutError };
export type { LayoutContext, LayoutQuery, Resource };
