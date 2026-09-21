import { nonnegative } from '../lib/checks'
import { DEFAULTS } from './defaults'
import { Element } from './element'
import { Fonts } from './fonts'
import { make_fragment } from './fragment'
import type { Fragment } from './fragment'
import { make_rect } from './geometry'
import { finish_size, make_request, prepare_request, resolve_sizing } from './layout'
import type { Axis, AxisSizing, LayoutRequest, Sizing } from './layout'
import { resolve_style } from './style'
import type { Style } from './style'
import { make_measure, measure_length, px, resolve_font_size, UnresolvedLengthError } from './units'
import type { LengthContext, ReferenceBox } from './units'
import { copy_coordinates } from './coordinates'
import type { Coordinates } from './coordinates'
import { copy_math_context } from './math'
import type { MathContext } from './math'
import { fitting_mode, fitting_requests, fit_fragment } from './fitting'

type LayoutContext = Readonly<{
  style?: Style; reference?: ReferenceBox; path?: string; coordinates?: Coordinates | null
  math?: MathContext | null
  // Host canvas at the root; resolved reference canvas for descendants.
  viewport?: ReferenceBox
}>
type Resource = Readonly<{ value: unknown; version: string | number }>
type LayoutQuery = Readonly<{
  request: LayoutRequest
  sizing: Sizing
  style: Style
  measure: LengthContext
  coordinates?: Coordinates
  math?: MathContext
  child: (
    element: Element, request: LayoutRequest, reference?: ReferenceBox, index?: number,
    context?: Pick<LayoutContext, 'coordinates' | 'style' | 'math'>,
  ) => Fragment
  resource: <T>(name: string) => T
  prepare: <T>(name: string, compute: () => T, dependencies?: readonly unknown[]) => T
}>

// Parent-owned metadata uses the child's local font and diagnostic path too.
function child_measure(element: Element, query: LayoutQuery, index = 0, reference: ReferenceBox = {}): LengthContext {
  const measure = make_measure(query.measure, { reference, path: `${query.measure.path}/${element.type.name}[${index}]` })
  return make_measure(measure, { font_size: resolve_font_size(element.props.font_size, measure) })
}

// References describe established boxes, not offers. Missing axes stay missing.
function copy_reference(reference: ReferenceBox = {}, path = 'reference'): ReferenceBox {
  const result: { width?: number; height?: number } = {}
  for (const axis of ['width', 'height'] as const) {
    const value = reference[axis]
    if (value !== undefined) result[axis] = nonnegative(value, `${path}.${axis}`)
  }
  return Object.freeze(result)
}

// Establish the canvas before the root font: authored references, definite root
// dimensions, then the host canvas. Budgets and measured content never supply it.
function root_viewport(element: Element, request: LayoutRequest, context: LayoutContext, path: string): ReferenceBox {
  const host = copy_reference(context.viewport, 'viewport')
  const authored = copy_reference(element.props.viewport, `${path}.viewport`)
  if (!element.type.viewport) return copy_reference({ ...host, ...authored }, `${path}.viewport`)
  const fixed: { width?: number; height?: number } = {}
  const axes = ['width', 'height'] as const
  for (const axis of axes) if (request[axis].kind === 'exact') fixed[axis] = request[axis].value
  const inherited = context.style?.font_size ?? DEFAULTS.font_size
  const props = element.props
  if (props.aspect !== undefined) resolve_sizing({ aspect: props.aspect })

  // Only fill unknown axes from already resolved inputs. Two axes can unlock
  // the root font and each other; circular dependencies remain unresolved.
  for (let step = 0; step < 3; step++) {
    const viewport = { ...fixed, ...authored }
    const measure = make_measure({ font_size: inherited, reference: context.reference, viewport, path })
    const font = measure_length(props.font_size ?? px(inherited),
      measure, inherited, 'font_size')
    const rules: Partial<Record<Axis, AxisSizing>> = {}
    let changed = false
    for (const axis of axes) {
      if (fixed[axis] !== undefined) continue
      try {
        const sizing = resolve_sizing({ [axis]: props[axis],
          [`min_${axis}`]: props[`min_${axis}`], [`max_${axis}`]: props[`max_${axis}`] },
        make_measure(measure, { font_size: typeof font === 'number' ? font : undefined }), request)
        const rule = rules[axis] = sizing[axis]
        const prepared = prepare_request(request, sizing)[axis]
        const value = prepared.kind === 'exact' ? prepared.value : rule.min === rule.max ? rule.min : undefined
        if (value !== undefined) { fixed[axis] = value; changed = true }
      } catch (error) {
        if (!(error instanceof UnresolvedLengthError)) throw error
      }
    }
    if (props.aspect !== undefined) {
      for (const axis of axes) {
        const other = axis === 'width' ? fixed.height : fixed.width
        const rule = rules[axis]
        if (fixed[axis] !== undefined || other === undefined || !rule) continue
        const value = axis === 'width' ? other * props.aspect : other / props.aspect
        fixed[axis] = Math.max(rule.min, Math.min(rule.max, value))
        changed = true
      }
    }
    if (!changed) break
  }
  // Use the host canvas only after independently established root dimensions,
  // so it cannot seed a sizing cycle and then be replaced by its result.
  return copy_reference({ ...host, ...fixed, ...authored }, `${path}.viewport`)
}

// Cache exactly the inputs visible to geometry. Diagnostic paths are not geometry.
function query_key(
  request: LayoutRequest, style: Style, measure: LengthContext, epoch: number,
  coordinates?: Coordinates, math?: MathContext,
): string {
  return JSON.stringify([request, style, measure.reference.width, measure.reference.height, epoch, coordinates, math, measure.viewport])
}

class LayoutError extends Error {
  readonly path: string

  // Preserve the original failure while identifying its element instance in the tree.
  constructor(path: string, cause: unknown) {
    super(`${path}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'LayoutError'
    this.path = path
  }
}

class LayoutPass {
  #cache = new WeakMap<Element, Map<string, Fragment>>()
  #prepared = new WeakMap<Element, Map<string, unknown>>()
  #active = new WeakMap<Element, Set<string>>()
  #resources = new Map<string, Resource>()
  #epoch = 0
  #queries = 0
  #layouts = 0
  #hits = 0

  // Resources and cache lifetimes belong to this pass, never to source elements.
  constructor(resources: Readonly<Record<string, Resource>> = {}) {
    if (!resources.fonts) this.set_resource('fonts', new Fonts(), 0)
    for (const [name, resource] of Object.entries(resources)) {
      this.set_resource(name, resource.value, resource.version)
    }
  }

  // Version changes conservatively invalidate the whole pass until finer reuse is useful.
  set_resource(name: string, value: unknown, version: string | number): void {
    const old = this.#resources.get(name)
    if (old && old.value === value && old.version === version) return
    this.#resources.set(name, Object.freeze({ value, version }))
    this.#epoch++
    this.#cache = new WeakMap()
    this.#prepared = new WeakMap()
  }

  // Resource access occurs during measurement; the renderer needs no resources.
  resource<T>(name: string): T {
    const resource = this.#resources.get(name)
    if (!resource) throw new Error(`Missing layout resource: ${name}`)
    return resource.value as T
  }

  // Counters make repeated queries and reuse observable without changing results.
  get stats() {
    return Object.freeze({ queries: this.#queries, layouts: this.#layouts, hits: this.#hits })
  }

  // Natural queries and final allocations run the same element implementation.
  layout(element: Element, request = make_request(), context: LayoutContext = {}): Fragment {
    return this.#layout(element, request, context, true)
  }

  #layout(element: Element, request: LayoutRequest, context: LayoutContext, root = false): Fragment {
    if (!(element instanceof Element)) throw new TypeError('Layout requires a next Element')
    const path = context.path ?? element.type.name
    this.#queries++

    try {
      request = make_request(request)
      const reference = copy_reference(context.reference)
      const viewport = root ? root_viewport(element, request, context, path) : context.viewport!
      const inherited = make_measure({ reference, viewport, path })
      const style = resolve_style(element.props, context.style, inherited)
      const measure = make_measure(inherited, { font_size: style.font_size })
      const coordinates = context.coordinates ? copy_coordinates(context.coordinates) : undefined
      const math = context.math ? copy_math_context(context.math) : undefined
      const key = query_key(request, style, measure, this.#epoch, coordinates, math)
      const cache = this.#cache.get(element) ?? new Map<string, Fragment>()
      this.#cache.set(element, cache)
      const cached = cache.get(key)
      if (cached) {
        this.#hits++
        return cached
      }

      // Detect recursive requests without caching failures or poisoning later queries.
      const active = this.#active.get(element) ?? new Set<string>()
      this.#active.set(element, active)
      if (active.has(key)) throw new Error('Recursive layout request')
      active.add(key)
      try {
        const own_sizing = resolve_sizing(element.props, measure, request)
        // Only a complete formula entering ordinary layout fits automatically.
        // Internal TeX queries carry a math context; inline text measures its
        // operands naturally. Explicit fit (including false) always takes precedence.
        const auto_fit = element.type.auto_fit && !math && (request.width.kind !== 'natural'
          || request.height.kind !== 'natural' || own_sizing.width.max < Infinity || own_sizing.height.max < Infinity)
        const fit = fitting_mode(element.props.fit === undefined && auto_fit ? true : element.props.fit)
        const fitting = fit && fitting_requests(request, own_sizing)
        const sizing = fitting ? fitting.intrinsic : own_sizing
        const prepared = fitting ? fitting.natural : prepare_request(request, sizing)
        const query: LayoutQuery = Object.freeze({
          request: prepared, sizing, style, measure, coordinates, math,
          child: (child, offer, basis = {}, index = 0, context = {}) => this.#layout(child, offer, {
            style, coordinates, math, ...context, viewport, reference: basis, path: `${path}/${child.type.name}[${index}]`,
          }),
          resource: <T>(name: string) => this.resource<T>(name),
          // Inline styles may use viewport units even when the owning style does
          // not. Local offers and percentage references still do not affect preparation.
          // Callers may supply narrower dependencies, such as [] for canvas-independent prose.
          prepare: <T>(name: string, compute: () => T, dependencies: readonly unknown[] = [viewport]): T => {
            const cache = this.#prepared.get(element) ?? new Map<string, unknown>()
            this.#prepared.set(element, cache)
            const key = JSON.stringify([name, style, this.#epoch, math, dependencies])
            if (!cache.has(key)) cache.set(key, compute())
            return cache.get(key) as T
          },
        })

        // Resizing a fitted element can reuse its natural drawing. This key
        // includes every input visible to the source layout, but not the target.
        const intrinsic_key = fitting
          ? `intrinsic:${query_key(prepared, style, measure, this.#epoch, coordinates, math)}` : undefined
        let result = intrinsic_key ? cache.get(intrinsic_key) : undefined
        if (result) this.#hits++
        else {
          this.#layouts++
          result = element.type.layout(element, query)
        }
        const size = finish_size(result.size, prepared, sizing)
        if (size.width !== result.size.width || size.height !== result.size.height) {
          throw new Error('Element returned a size outside its sizing policy; use finish_size')
        }
        if (fitting) {
          cache.set(intrinsic_key!, result)
          // Attach a leaf's fallback connection before scaling so its boundary
          // follows the visible source, not a potentially letterboxed target.
          if (element.props.id !== undefined && result.connection === undefined) {
            result = make_fragment({ ...result,
              connection: { id: element.props.id, boundary: make_rect(0, 0, size.width, size.height) } })
          }
          result = fit_fragment(result, fitting.request, fitting.target, fit!, element.props.fit_align)
        }
        // An id makes any element connectable; elements may refine the boundary.
        const { id } = element.props
        const connection = id === undefined ? result.connection
          : { id, boundary: result.connection?.boundary ?? make_rect(0, 0, result.size.width, result.size.height) }
        const fragment = make_fragment({ ...result, name: element.type.name,
          debug: element.props.debug ?? result.debug, connection })
        cache.set(key, fragment)
        return fragment
      } finally {
        active.delete(key)
      }
    } catch (error) {
      if (error instanceof LayoutError || error instanceof UnresolvedLengthError) throw error
      throw new LayoutError(path, error)
    }
  }
}

export { LayoutPass, LayoutError, child_measure }
export type { LayoutContext, LayoutQuery, Resource }
