import { Element } from './engine/element'
import { LayoutPass } from './engine/pass'
import type { FontProvider } from './engine/fonts'
import type { LayoutRequest } from './engine/layout'
import type { Fragment } from './engine/fragment'
import type { Size } from './engine/geometry'
import { Svg } from './elems/svg'
import type { SvgProps } from './elems/svg'
import { render_svg } from './svg'
import type { SvgOptions } from './svg'

// Source props beat defaults; overrides beat source props, as when a host theme wins.
// Wrap props configure only the viewport generated around a bare element, such as
// maximum canvas bounds with shrink-to-fit; an existing Svg ignores them.
// Undefined entries are absent, so
// optional caller settings can be forwarded directly.
type ViewportOptions = Readonly<{ defaults?: SvgProps; overrides?: SvgProps; wrap?: SvgProps }>
// A reused pass keeps its cache; otherwise fonts, or the core defaults, seed a new one.
// Fonts given alongside a pass are installed on it, refreshing the cache if they changed.
type LayoutElementOptions = ViewportOptions & Readonly<{
  request?: LayoutRequest
  pass?: LayoutPass
  fonts?: FontProvider
}>
type RenderElementOptions = LayoutElementOptions & SvgOptions

// Evaluated sources may return plain values; those pass through unrendered.
// Element results carry the pass they used so a host can reuse it or read its stats.
type ValueResult = Readonly<{ kind: 'value'; value: unknown }>
type FragmentResult = Readonly<{ kind: 'fragment'; fragment: Fragment; pass: LayoutPass }>
type SvgResult = Readonly<{ kind: 'svg'; svg: string; size: Size; fragment: Fragment; pass: LayoutPass }>
type LayoutElementResult = FragmentResult | ValueResult
type RenderElementResult = SvgResult | ValueResult

function defined(props: SvgProps): SvgProps {
  return Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) as SvgProps
}

// Providers that track registrations expose a version; others never invalidate.
function font_version(fonts: FontProvider): string | number {
  const version = (fonts as { version?: unknown }).version
  return typeof version === 'number' || typeof version === 'string' ? version : 0
}

function resolve_pass({ pass, fonts }: LayoutElementOptions): LayoutPass {
  if (pass) {
    if (fonts) pass.set_resource('fonts', fonts, font_version(fonts))
    return pass
  }
  return fonts ? new LayoutPass({ fonts: { value: fonts, version: font_version(fonts) } }) : new LayoutPass()
}

// A bare element gets a viewport that hugs it. An existing viewport keeps its
// layout descriptor and props, so custom Svg subclasses survive the host policy.
function make_viewport(element: Element, { defaults = {}, overrides = {}, wrap = {} }: ViewportOptions = {}): Svg {
  const viewport = element instanceof Svg ? element : new Svg({ ...defined(wrap), children: element })
  return new Svg(viewport.type, { ...defined(defaults), ...viewport.props, ...defined(overrides) })
}

// Element to fragment: wrap, then lay out under the caller's request.
function layout_element(element: Element, options?: LayoutElementOptions): FragmentResult
function layout_element(value: unknown, options?: LayoutElementOptions): LayoutElementResult
function layout_element(value: unknown, options: LayoutElementOptions = {}): LayoutElementResult {
  if (!(value instanceof Element)) return { kind: 'value', value }
  const pass = resolve_pass(options)
  const fragment = pass.layout(make_viewport(value, options), options.request)
  return { kind: 'fragment', fragment, pass }
}

// Element to SVG markup, with the realized size for hosts that rasterize or embed.
function render_element(element: Element, options?: RenderElementOptions): SvgResult
function render_element(value: unknown, options?: RenderElementOptions): RenderElementResult
function render_element(value: unknown, options: RenderElementOptions = {}): RenderElementResult {
  const { request, defaults, overrides, wrap, pass, fonts, ...svg_options } = options
  const result = layout_element(value, { request, defaults, overrides, wrap, pass, fonts })
  if (result.kind === 'value') return result
  const { fragment } = result
  return { kind: 'svg', svg: render_svg(fragment, svg_options), size: fragment.size, fragment, pass: result.pass }
}

export { make_viewport, layout_element, render_element }
export type {
  ViewportOptions, LayoutElementOptions, RenderElementOptions,
  LayoutElementResult, RenderElementResult,
}
