import { Element } from './engine/element'
import { LayoutPass } from './engine/pass'
import type { FontProvider } from './engine/fonts'
import type { LayoutRequest } from './engine/layout'
import type { Fragment } from './engine/fragment'
import type { Size } from './engine/geometry'
import { Page } from './elems/page'
import type { PageProps } from './elems/page'
import { render_svg } from './svg'
import type { SvgOptions } from './svg'
import { Document } from './document'

// Source props beat defaults; overrides beat source props, as when a host theme wins.
// Wrap props configure only the viewport generated around a bare element, such as
// maximum canvas bounds with shrink-to-fit; an existing Page ignores them.
// Undefined entries are absent, so
// optional caller settings can be forwarded directly.
type ViewportOptions = Readonly<{ defaults?: PageProps; overrides?: PageProps; wrap?: PageProps }>
type TextRenderMode = 'path' | 'live' | 'mixed'
// A reused pass keeps its cache; otherwise fonts, or the core defaults, seed a new one.
// Fonts given alongside a pass are installed on it, refreshing the cache if they changed.
type LayoutElementOptions = ViewportOptions & Readonly<{
  request?: LayoutRequest
  pass?: LayoutPass
  fonts?: FontProvider
  /** Live renders prose and math as text; mixed keeps math outlined. */
  text_mode?: TextRenderMode
}>
type RenderElementOptions = LayoutElementOptions & SvgOptions

// Evaluated sources may return plain values; those pass through unrendered.
// Element results carry the pass they used so a host can reuse it or read its stats.
type ValueResult = Readonly<{ kind: 'value'; value: unknown }>
type FragmentResult = Readonly<{ kind: 'fragment'; fragment: Fragment; pass: LayoutPass }>
type SvgResult = Readonly<{ kind: 'svg'; svg: string; size: Size; fragment: Fragment; pass: LayoutPass }>
type DocumentLayoutResult = Readonly<{
  kind: 'document'; pages: readonly Fragment[]; title?: string; pass: LayoutPass
}>
type DocumentRenderResult = Readonly<{
  kind: 'document'; pages: readonly SvgResult[]; title?: string; pass: LayoutPass
}>
type LayoutElementResult = FragmentResult | DocumentLayoutResult | ValueResult
type RenderElementResult = SvgResult | DocumentRenderResult | ValueResult

function defined(props: PageProps): PageProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as PageProps
}

// Providers that track registrations expose a version; others never invalidate.
function font_version(fonts: FontProvider): string | number {
  const version = (fonts as { version?: unknown }).version
  return typeof version === 'number' || typeof version === 'string' ? version : 0
}

function resolve_pass({ pass, fonts, text_mode = 'path' }: LayoutElementOptions): LayoutPass {
  if (text_mode !== 'path' && text_mode !== 'live' && text_mode !== 'mixed') {
    throw new TypeError('text_mode must be path, live, or mixed')
  }
  const result = pass ?? new LayoutPass(fonts ? { fonts: { value: fonts, version: font_version(fonts) } } : {})
  if (pass && fonts) result.set_resource('fonts', fonts, font_version(fonts))
  result.set_resource('text_mode', text_mode, text_mode)
  return result
}

// A bare element gets a viewport that hugs it. An existing viewport keeps its
// layout descriptor and props, so custom Page subclasses survive the host policy.
function make_viewport(element: Element, { defaults = {}, overrides = {}, wrap = {} }: ViewportOptions = {}): Page {
  const viewport = element instanceof Page ? element
    : new Page({ ...defined(wrap), children: element })
  return new Page(viewport.type, { ...defined(defaults), ...defined(viewport.props), ...defined(overrides) })
}

// Page props win over document defaults, and explicit host overrides win over both.
function layout_document(document: Document, options: LayoutElementOptions = {}): DocumentLayoutResult {
  const pass = resolve_pass(options)
  const defaults = { ...defined(options.defaults ?? {}), ...defined(document.defaults) }
  const pages = document.pages.map(page =>
    pass.layout(make_viewport(page, { ...options, defaults }), options.request))
  return { kind: 'document', pages, title: document.title, pass }
}

// Element to fragment: wrap, then lay out under the caller's request.
function layout_element(element: Element, options?: LayoutElementOptions): FragmentResult
function layout_element(document: Document, options?: LayoutElementOptions): DocumentLayoutResult
function layout_element(value: unknown, options?: LayoutElementOptions): LayoutElementResult
function layout_element(value: unknown, options: LayoutElementOptions = {}): LayoutElementResult {
  if (value instanceof Document) return layout_document(value, options)
  if (!(value instanceof Element)) return { kind: 'value', value }
  const pass = resolve_pass(options)
  const fragment = pass.layout(make_viewport(value, options), options.request)
  return { kind: 'fragment', fragment, pass }
}

// Element to SVG markup, with the realized size for hosts that rasterize or embed.
function render_element(element: Element, options?: RenderElementOptions): SvgResult
function render_element(document: Document, options?: RenderElementOptions): DocumentRenderResult
function render_element(value: unknown, options?: RenderElementOptions): RenderElementResult
function render_element(value: unknown, options: RenderElementOptions = {}): RenderElementResult {
  const { request, defaults, overrides, wrap, pass, fonts, text_mode, ...svg_options } = options
  const result = layout_element(value, { request, defaults, overrides, wrap, pass, fonts, text_mode })
  if (result.kind === 'value') return result
  if (result.kind === 'document') {
    // Each SVG has its own definition namespace, so a viewer can embed all pages.
    const title = svg_options.title ?? result.title
    const pages = result.pages.map((fragment, index): SvgResult => ({
      kind: 'svg', fragment, pass: result.pass, size: fragment.size,
      svg: render_svg(fragment, { ...svg_options, title,
        id_prefix: `${svg_options.id_prefix ?? 'gum'}-page-${index + 1}` }),
    }))
    return { kind: 'document', pages, title, pass: result.pass }
  }
  const { fragment } = result
  return { kind: 'svg', svg: render_svg(fragment, svg_options), size: fragment.size, fragment, pass: result.pass }
}

export { make_viewport, layout_document, layout_element, render_element }
export type {
  ViewportOptions, LayoutElementOptions, RenderElementOptions,
  LayoutElementResult, RenderElementResult,
  DocumentLayoutResult, DocumentRenderResult,
  TextRenderMode,
}
