// Shared measurement and placement. No knowledge of text or math classes:
// elements supply natural dimensions and optionally implement reflow.
import { Element, Group, align_frac } from './core'
import { make_em, em_aspect, em_rect, hull_overhang, scale_em_spec } from '../lib/em'
import { ensure_pair, max, sum } from '../lib/utils'
import type { EmSpec } from '../lib/em'
import type { Rect, Align } from '../lib/types'
import type { Sizing, LayoutOffer, LayoutResult, RowAlign, PackOptions } from '../lib/layout'

function element_sizing(elem: Element): Sizing {
    const em = (elem as Element & { em?: EmSpec }).em
    let width = elem.spec.width ?? em?.width
    let height = elem.spec.height ?? em?.height
    const aspect = elem.spec.aspect
    if (aspect != null && aspect > 0) {
        if (elem.spec.width != null && elem.spec.height == null) height = elem.spec.width / aspect
        if (elem.spec.height != null && elem.spec.width == null) width = elem.spec.height * aspect
        width ??= height != null ? height * aspect : undefined
        height ??= width != null ? width / aspect : undefined
    }
    return { width, height, aspect: width != null && height != null && height > 0 ? width / height : elem.spec.aspect }
}

function check_offer(offer: LayoutOffer): void {
    for (const key of ['width', 'height', 'maxWidth', 'maxHeight'] as const) {
        const v = offer[key]
        if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(`Invalid layout ${key}: ${v}`)
    }
}

// Reserve an allocation without changing the scale of its measured content.
// The wrapper's aspect belongs to the allocation; its child's to the ink.
function frame_layout(result: LayoutResult, width: number, height: number, align?: Align): LayoutResult {
    const { elem, em } = result
    if (width == em.width && height == em.height) return result
    const [ ax, ay ] = ensure_pair(elem.spec.align ?? align ?? 'center')
    const x = align_frac(ax) * (width - em.width)
    const y = align_frac(ay) * (height - em.height)
    const rect = em_rect(em, x, y + em.anchor)
    const { hink, vink, coord } = hull_overhang([rect], width, [0, height])
    const metrics = make_em({ width, height, anchor: y + em.anchor, scale: em.scale, hink, vink })
    const group = new Group({ children: [elem.clone({ rect })], coord, aspect: em_aspect(metrics), env: elem.env })
    return { elem: Object.assign(group, { em: metrics }), em: metrics }
}

// An explicit fractional slot fits the finished child, including its em,
// rather than reflowing it at the parent's scale. Placement remains shallow.
function fit_layout({ elem, em }: LayoutResult, width: number, height: number, align?: Align): LayoutResult {
    const factor = Math.min(em.width > 0 ? width / em.width : Infinity, em.height > 0 ? height / em.height : Infinity)
    const scale = width == 0 || height == 0 ? 0 : Number.isFinite(factor) ? factor : 1
    const metrics = make_em(scale_em_spec(em, scale))
    const coord = em_rect(em, 0, em.anchor)
    const drawable = scale > 0 && coord[0] != coord[2] && coord[1] != coord[3]
    const group = new Group({
        children: drawable ? [elem.clone({ rect: coord, stack_size: undefined, stack_expand: undefined, grow: undefined })] : [],
        coord: drawable ? coord : undefined,
        aspect: em_aspect(metrics), align: elem.spec.align, env: elem.env,
    })
    return frame_layout({ elem: Object.assign(group, { em: metrics }), em: metrics }, width, height, align)
}

function layout_element(elem: Element, offer: LayoutOffer = {}): LayoutResult {
    check_offer(offer)
    const natural = (elem as Element & { em?: EmSpec }).em
    const { width: ownWidth, height: ownHeight, aspect } = elem.spec
    let width = ownWidth ?? natural?.width
    let height = ownHeight ?? natural?.height
    // An explicit dimension sizes content; an offered dimension allocates a
    // slot. The distinction keeps a short formula at its surrounding em.
    if (ownWidth != null && ownHeight == null && aspect) height = ownWidth / aspect
    if (ownHeight != null && ownWidth == null && aspect) width = ownHeight * aspect
    if (natural != null) {
        let em = natural
        if (ownWidth != null || ownHeight != null) {
            const sx = natural.width > 0 && width != null ? width / natural.width : Infinity
            const sy = natural.height > 0 && height != null ? height / natural.height : Infinity
            const scale = Math.min(sx, sy)
            if (Number.isFinite(scale) && scale != 1) em = make_em(scale_em_spec(natural, scale))
        }
        return frame_layout({ elem, em }, offer.width ?? ownWidth ?? em.width, offer.height ?? ownHeight ?? em.height, offer.attrs?.justify)
    }
    width ??= offer.width ?? offer.maxWidth
    height ??= offer.height ?? offer.maxHeight
    if (aspect != null && aspect > 0) {
        width ??= height != null ? height * aspect : aspect
        height ??= width / aspect
    } else {
        width ??= 0
        height ??= 0
    }
    // Maximum dimensions bound the content; only exact dimensions reserve
    // the unused portion of a slot.
    if (aspect != null && aspect > 0 && width > 0 && height > 0) {
        const h = Math.min(height, width / aspect)
        const w = h * aspect
        return frame_layout({ elem, em: make_em({ width: w, height: h, anchor: h / 2 }) }, offer.width ?? ownWidth ?? w, offer.height ?? ownHeight ?? h, offer.attrs?.justify)
    }
    const em = make_em({ width, height, anchor: height / 2 })
    if (width == 0 || height == 0) return { elem: new Group({ children: [], env: elem.env }), em }
    return { elem, em }
}

// Reflow-capable constructors use their own em. Rebuild only when the
// request changes it; placement continues to use Element's shallow clone.
function layout_reflow(elem: Element, offer: LayoutOffer = {}, height = false): LayoutResult {
    check_offer(offer)
    const scale = (elem as Element & { em?: EmSpec }).em?.scale ?? elem.args.scale ?? 1
    const width = elem.args.width ?? ((offer.width ?? offer.maxWidth) != null ? (offer.width ?? offer.maxWidth)! / scale : undefined)
    const patch = { ...offer.attrs, ...(width != null ? { width } : {}) } as Record<string, any>
    if (height && elem.args.height == null && (offer.height ?? offer.maxHeight) != null) patch.height = (offer.height ?? offer.maxHeight)! / scale
    const changed = Object.keys(patch).some(k => patch[k] !== elem.args[k])
    const out = changed ? elem.clone(patch) : elem
    return layout_element(out, offer)
}

function child_align({ elem }: LayoutResult) {
    return elem.spec.align != null ? ensure_pair(elem.spec.align) : [undefined, undefined]
}

function row_offsets(laid: LayoutResult[], valign: RowAlign): number[] {
    const height = max(laid.map(l => l.em.height)) ?? 0
    const anchor = max(laid.map(l => l.em.anchor)) ?? 0
    return laid.map(l => {
        const align = child_align(l)[1] ?? valign
        return align == 'anchor' ? anchor - l.em.anchor : align_frac(align as any) * (height - l.em.height)
    })
}

// Shared packing for geometric, text, and math rows/columns. Layout bounds
// determine spacing; the ink hull is retained separately through every nest.
function pack_layout(laid: LayoutResult[], options: PackOptions = {}): { children: Element[], coord: Rect, aspect?: number, metrics: EmSpec } {
    const { direc = 'h', gap = 0, justify = 'left', valign = 'top', anchor: anchorMode = 'first', overflow = 'visible' } = options
    const horizontal = direc == 'h'
    const ys = horizontal ? row_offsets(laid, valign) : []
    const gaps = gap * Math.max(laid.length - 1, 0)
    const packedWidth = horizontal ? sum(laid.map(l => l.em.width)) + gaps : max(laid.map(l => l.em.width)) ?? 0
    const packedHeight = horizontal ? max(laid.map((l, i) => ys[i] + l.em.height)) ?? 0 : sum(laid.map(l => l.em.height)) + gaps
    const width = options.width ?? (overflow == 'visible' ? packedWidth : Math.min(packedWidth, options.maxWidth ?? Infinity))
    const height = options.height ?? (overflow == 'visible' ? packedHeight : Math.min(packedHeight, options.maxHeight ?? Infinity))
    let cursor = horizontal ? align_frac(justify) * Math.max(0, width - packedWidth) : 0
    let firstAnchor = 0
    const rects = laid.map((l, i) => {
        const x = horizontal ? cursor : align_frac(child_align(l)[0] ?? justify) * (width - l.em.width)
        const y = horizontal ? ys[i] : cursor
        if (i == 0) firstAnchor = y + l.em.anchor
        cursor += (horizontal ? l.em.width : l.em.height) + gap
        return em_rect(l.em, x, y + l.em.anchor)
    })
    let children = laid.map((l, i) => {
        const placement: Record<string, any> = { rect: rects[i] }
        if (l.elem.attr.stack_size != null) placement.stack_size = undefined
        if (l.elem.attr.stack_expand != null) placement.stack_expand = undefined
        if (l.elem.attr.grow != null) placement.grow = undefined
        return l.elem.clone(placement)
    })
    let { hink, vink, coord } = hull_overhang(rects, width, [0, height])
    let anchor = anchorMode == 'center' ? height / 2 : firstAnchor
    const over = coord[0] < -1e-9 || coord[1] < -1e-9 || coord[2] > width + 1e-9 || coord[3] > height + 1e-9
    if (over && overflow == 'error') throw new Error(`Layout overflows ${width}×${height}`)
    if (over && overflow == 'shrink') {
        const inkWidth = coord[2] - coord[0], inkHeight = coord[3] - coord[1]
        const scale = Math.min(inkWidth > 0 ? width / inkWidth : 1, inkHeight > 0 ? height / inkHeight : 1)
        const body = new Group({ children, coord, aspect: inkWidth / inkHeight, env: laid[0]?.elem.env })
        children = scale > 0 ? [body.clone({ rect: [0, 0, inkWidth * scale, inkHeight * scale] })] : []
        anchor = (anchor - coord[1]) * scale
        hink = vink = undefined
        coord = [0, 0, width, height]
    } else if (overflow == 'clip') {
        children = width > 0 && height > 0 ? [new Group({ children, coord: [0, 0, width, height], clip: true, env: laid[0]?.elem.env })] : []
        hink = vink = undefined
        coord = [0, 0, width, height]
    }
    const metrics = make_em({ width, height, anchor, hink, vink })
    return { children, coord, aspect: em_aspect(metrics), metrics }
}

export { element_sizing, layout_element, layout_reflow, frame_layout, child_align, row_offsets, pack_layout }

interface StackLayoutOptions extends PackOptions {
    spacing?: number
    even?: boolean
    sizes?: number[]
    attrs?: LayoutOffer['attrs']
}

function layout_stack(children: Element[], options: StackLayoutOptions = {}) {
    check_offer(options)
    const { direc = 'h', spacing = 0, even = false, sizes, attrs } = options
    const inherited = { ...attrs, justify: options.justify }
    const horizontal = direc == 'h'
    const main = horizontal ? 'width' : 'height'
    const cross = horizontal ? 'height' : 'width'
    const maxMain = horizontal ? options.maxWidth : options.maxHeight
    const maxCross = horizontal ? options.maxHeight : options.maxWidth
    const mainBudget = options[main] ?? maxMain
    const crossBudget = options[cross] ?? maxCross
    const specs = children.map(c => c.sizing)
    const hasShares = even || children.some(c => c.args.stack_size != null)
    let shareTotal = 0
    const shares: (number | undefined)[] = hasShares ? children.map(c => {
        const share = c.args.stack_size
        if (share != null) {
            if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error('stack-size must be a fraction between 0 and 1')
            shareTotal += share
        }
        return share
    }) : []
    if (shareTotal > 1 + 1e-12) throw new Error('stack-size fractions must sum to at most 1')
    // Even is shorthand for fractional shares, using exactly the same fitting
    // path. Explicit fractions reserve space before the others divide it.
    if (even) {
        const missing = shares.filter(s => s == null).length
        if (missing > 0) {
            const share = Math.max(0, 1 - shareTotal) / missing
            for (let i = 0; i < shares.length; i++) shares[i] ??= share
            shareTotal = 1
        }
    }
    const freeShare = Math.max(0, 1 - shareTotal)
    const measured = options.width != null || options.height != null || options.maxWidth != null || options.maxHeight != null || options.gap != null || specs.some(s => s.width != null || s.height != null)
    const geometric = specs.every(s => s.width == null && s.height == null)
    const ratios = specs.map(s => s.aspect != null && s.aspect > 0 ? (horizontal ? s.aspect : 1 / s.aspect) : undefined)
    const gap0 = options.gap ?? 0
    const gaps0 = gap0 * Math.max(0, children.length - 1)
    let crossSize = crossBudget ?? max(specs.map((s, i) => shares[i] === 0 ? undefined : s[cross]).filter(x => x != null))
    // With only ratios, choose the shared cross size that fills the main
    // budget. With no budget, one is a normalization, not an intrinsic em.
    if (geometric && mainBudget != null && ratios.every(a => a != null)) {
        const content = Math.max(0, mainBudget * (options.gap == null && children.length > 1 ? 1 - spacing : 1) - gaps0)
        const naturalRatio = hasShares ? sum(ratios.map((a, i) => shares[i] == null ? a! : 0)) : sum(ratios as number[])
        const fit = naturalRatio > 0 ? content * freeShare / naturalRatio : max(ratios.map((a, i) => a! > 0 ? content * (shares[i] ?? 0) / a! : 0)) ?? 0
        crossSize = Math.min(crossSize ?? Infinity, fit)
    }
    crossSize ??= 1

    const weight = children.map((c, i) => shares[i] != null ? 0 : sizes?.[i] ?? c.args.grow ?? 0)
    if (weight.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Layout weights must be finite and nonnegative')
    if (!Number.isFinite(gap0) || !Number.isFinite(spacing) || spacing >= 1) throw new Error('Invalid layout gap or spacing')
    children.forEach((c, i) => {
        if (shares[i] == null && sizes == null && c.args.grow == null && !c.reflow && specs[i][main] == null && ratios[i] == null) weight[i] = 1
    })
    // Pack naturally when it fits. If a bounded row is too narrow, wrapping
    // children share what remains after fixed content. Growth is explicit.
    if (horizontal && mainBudget != null && sizes == null && !even) {
        const natural = sum(specs.map((s, i) => shares[i] != null || weight[i] > 0 ? 0 : s.width ?? (ratios[i] ?? 0) * crossSize!)) + gaps0
        if (natural > mainBudget * freeShare) children.forEach((c, i) => {
            if (shares[i] == null && c.reflow && c.args.width == null && c.args.grow == null) weight[i] = 1
        })
    }
    const inheritedBy = (c: Element) => c.args.justify != null ? { ...inherited, justify: c.args.justify } : inherited
    const flexible = (i: number) => specs[i].aspect == null && (specs[i].width == null || specs[i].height == null)
    const bases = hasShares ? children.map((c, i) => shares[i] != null ? c.layout({
        attrs: inheritedBy(c), ...(flexible(i) ? { maxWidth: crossSize, maxHeight: crossSize } : {}),
    }) : null) : []
    const measure = (c: Element, i: number, slot?: number): LayoutResult => {
        if (shares[i] != null) {
            const width = horizontal ? slot! : crossSize!, height = horizontal ? crossSize! : slot!
            // A flexible shape has no complete box to fit until allocated.
            const basis = flexible(i) ? c.layout({ maxWidth: width, maxHeight: height, attrs: inheritedBy(c) }) : bases[i]!
            return fit_layout(basis, width, height, options.justify)
        }
        const offer: LayoutOffer = { attrs: inheritedBy(c) }
        if (!horizontal) offer.width = options.width ?? ((slot == null || c.reflow || ratios[i] == null) && (specs[i].width == null || c.reflow) ? crossSize : undefined)
        else if (specs[i].height == null && !c.reflow) offer.height = slot == null || ratios[i] == null ? crossSize : options.height
        if (slot != null) offer[main] = slot
        else if (mainBudget == null && specs[i][main] == null && ratios[i] == null && !c.reflow) offer[main] = crossSize
        if (horizontal && crossBudget != null) offer.maxHeight = crossBudget
        if (!horizontal && crossBudget != null) offer.maxWidth = crossBudget
        if (!horizontal && mainBudget != null) offer.maxHeight = mainBudget
        return c.layout(offer)
    }
    let laid: (LayoutResult | null)[] = children.map((c, i) => shares[i] != null || (mainBudget != null && weight[i] > 0) ? null : measure(c, i))
    const used = sum(laid.map(l => l?.em[main] ?? 0))
    const n = children.length
    let budget = mainBudget
    if (hasShares && budget == null) {
        if (freeShare == 0 && used > 0) throw new Error('stack-size leaves no room for natural children; reduce the fractions or give the stack an explicit main dimension')
        // Natural children determine the unreserved part. If every child has
        // a share, choose the size at which the first one fills the cross axis.
        const candidates = bases.flatMap((b, i) => b != null && shares[i]! > 0 && b.em[main] > 0
            ? [(b.em[cross] > 0 ? b.em[main] * crossSize! / b.em[cross] : b.em[main]) / shares[i]!]
            : [])
        const content = used > 0 ? used / freeShare : candidates.length > 0 ? Math.min(...candidates) : 0
        budget = (content + gaps0) / (options.gap == null && n > 1 ? 1 - spacing : 1)
    }
    const gap = options.gap ?? (n > 1 && spacing > 0 ? (budget != null ? budget * spacing : used * spacing / (1 - spacing)) / (n - 1) : 0)
    const totalWeight = sum(weight)
    const content = Math.max(0, (budget ?? 0) - gap * Math.max(n - 1, 0))
    const remaining = Math.max(0, content * freeShare - used)
    laid = laid.map((l, i) => l ?? (shares[i] != null ? null : measure(children[i], i, totalWeight > 0 ? remaining * weight[i] / totalWeight : 0)))
    if (hasShares) {
        // Allocated geometry can establish a larger cross dimension. Fit the
        // overrides after that is known, without reflowing natural children.
        if (crossBudget == null) crossSize = Math.max(crossSize, max(laid.map(l => l?.em[cross] ?? 0)) ?? 0)
        laid = laid.map((l, i) => l ?? measure(children[i], i, content * shares[i]!))
    }
    const result = pack_layout(laid as LayoutResult[], { ...options, ...(hasShares ? { [main]: budget } : {}), gap })
    return { ...result, aspect: !measured && !hasShares && ratios.some(a => a == null) ? undefined : result.aspect, measured }
}

export { layout_stack }
export type { StackLayoutOptions }
