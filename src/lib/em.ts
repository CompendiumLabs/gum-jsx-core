// em metrics: the layout box an element carries in em units
//
// An element that takes part in em layout (the math elements, the Text*
// elements) carries an `em` record describing its layout box in em, the unit
// its container measures in. Everything is in one frame: the element's own,
// top-left origin, y down.
//
//   width    layout box width, x from 0 at the left edge
//   height   layout box height, y from 0 at the top
//   anchor   y of the anchor, down from the top. The anchor is the math axis:
//            for a glyph the axis through the middle of `=`, for a text block
//            the axis of its first line
//   scale    the em of the content relative to the em these are stated in (a
//            script is laid out in its own em and reports metrics scaled to its
//            parent's); the content's baseline sits maxis * scale below the anchor
//   hink     horizontal ink range when it overhangs [0, width] (\rlap, strikes)
//   vink     vertical ink range when it overhangs [0, height] (\smash)
//
// Containers align children by their anchors, so most layout code works in
// anchor-relative bounds: `em_bounds` is the layout box about the anchor
// ([-anchor, height - anchor], TeX's height and depth with the signs of y down)
// and `em_ink` the ink box about it. A group assembled from placed children
// keeps that anchor frame as its `coord` (the anchor at y = 0) and records its
// own box with `bounds_em`.

import { maxis } from './const'
import { merge_limits } from './utils'
import type { Limit, Rect } from './types'
import type { TextMetrics } from './text'

//
// types
//

interface EmArgs {
    scale?: number  // own em over the surrounding em; compounds when nested
}

type EmSpec = {
    width: number
    height: number
    anchor: number
    scale: number
    hink?: Limit
    vink?: Limit
}

// what an element needs to state; the rest have defaults (see make_em)
type EmMetrics = Pick<EmSpec, 'width' | 'height' | 'anchor'> & Partial<Pick<EmSpec, 'scale' | 'hink' | 'vink'>>

//
// constants
//

const EMPTY_EM: EmMetrics = { width: 0, height: 0, anchor: 0 }

// the box an element without metrics gets: as wide as its aspect, one em tall
// and centered on the anchor
const DEFAULT_EM: EmMetrics = { width: 1, height: 1, anchor: 0.5 }

//
// construction
//

// fill in the defaults; any extra fields (a subtype's) pass through
function make_em<T extends Partial<EmSpec>>(spec: T): T & EmSpec {
    const { width, height, anchor, scale, hink, vink } = spec
    return {
        ...spec,
        width: width ?? EMPTY_EM.width,
        height: height ?? EMPTY_EM.height,
        anchor: anchor ?? EMPTY_EM.anchor,
        scale: scale ?? 1,
        hink,
        vink,
    }
}

// the box a Span's text metrics describe: its text box, with the anchor maxis
// below the top of the box (a line box with the axis at maxis)
function text_em({ advance, vrange: [ ylo, yhi ] }: TextMetrics): EmMetrics {
    return { width: advance, height: yhi - ylo, anchor: maxis - ylo }
}

// metrics from anchor-relative bounds (a layout that placed its children about
// the anchor at y = 0): `vink` is given in the same anchor frame
function bounds_em(width: number, [ lo, hi ]: Limit, { hink, vink }: { hink?: Limit, vink?: Limit } = {}): EmMetrics {
    return {
        width,
        height: hi - lo,
        anchor: 0 - lo,
        hink,
        vink: vink != null ? [ vink[0] - lo, vink[1] - lo ] : undefined,
    }
}

//
// queries
//

// the layout box about the anchor
function em_bounds({ height, anchor }: EmMetrics): Limit {
    return [ 0 - anchor, height - anchor ]
}

// the horizontal ink range from the left edge
function em_hink({ width, hink }: EmMetrics): Limit {
    return hink ?? [ 0, width ]
}

// the vertical ink range about the anchor: the layout box unless the ink
// overhangs it
function em_vink({ height, anchor, vink }: EmMetrics): Limit {
    return vink != null ? [ vink[0] - anchor, vink[1] - anchor ] : [ 0 - anchor, height - anchor ]
}

// the ink box aspect
function em_aspect(em: EmMetrics): number | undefined {
    const [ xlo, xhi ] = em_hink(em)
    const [ ylo, yhi ] = em_vink(em)
    const height = yhi - ylo
    return height > 0 ? (xhi - xlo) / height : undefined
}

// the rect an item draws into when its anchor sits at (x, y): the ink box
function em_rect(em: EmMetrics, x: number = 0, y: number = 0): Rect {
    const [ xlo, xhi ] = em_hink(em)
    const [ ylo, yhi ] = em_vink(em)
    return [ x + xlo, y + ylo, x + xhi, y + yhi ]
}

// the ink hull of placed rects (in the anchor frame) against the layout box:
// hink and vink are only set when the ink actually overhangs, and vink is in
// the anchor frame like the bounds (see bounds_em)
function hull_overhang(rects: Rect[], width: number, bounds: Limit): { hink?: Limit, vink?: Limit, coord: Rect } {
    const [ xlo, xhi ] = merge_limits([ [ 0, width ], ...rects.map(([ x1, , x2 ]) => [ x1, x2 ] as Limit) ])
    const [ ylo, yhi ] = merge_limits([ bounds, ...rects.map(([ , y1, , y2 ]) => [ y1, y2 ] as Limit) ])
    const hink: Limit | undefined = (xlo == 0 && xhi == width) ? undefined : [ xlo, xhi ]
    const vink: Limit | undefined = (ylo == bounds[0] && yhi == bounds[1]) ? undefined : [ ylo, yhi ]
    return { hink, vink, coord: [ xlo, ylo, xhi, yhi ] }
}

// height above and depth below the baseline of an item in a given scale (its
// baseline sits maxis * scale below its anchor); defaults to the scale the
// item carries
function baseline_extents(em: EmSpec, scale: number = em.scale): [ number, number ] {
    const [ lo, hi ] = em_bounds(em)
    const baseline = maxis * scale
    return [ baseline - lo, hi - baseline ]
}

//
// transforms
//

// the box scaled uniformly, for content laid out in a smaller em and reported
// in its parent's; `scale` compounds
function scale_em_spec({ width, height, anchor, scale: scale0, hink, vink }: EmSpec, scale: number): Pick<EmSpec, 'width' | 'height' | 'anchor' | 'scale' | 'hink' | 'vink'> {
    return {
        width: scale * width,
        height: scale * height,
        anchor: scale * anchor,
        scale: scale * scale0,
        hink: hink != null ? [ scale * hink[0], scale * hink[1] ] : undefined,
        vink: vink != null ? [ scale * vink[0], scale * vink[1] ] : undefined,
    }
}

//
// exports
//

export { EMPTY_EM, DEFAULT_EM, make_em, text_em, bounds_em, em_bounds, em_hink, em_vink, em_aspect, em_rect, hull_overhang, baseline_extents, scale_em_spec }
export type { EmArgs, EmSpec, EmMetrics }
