// Layout dimensions are in the surrounding layout unit (an em in text).
// Missing means unconstrained; zero is a real size. Drawing coordinates are
// independent of these dimensions.
import type { Attrs, AlignValue, Orient } from './types'
import type { EmSpec } from './em'
import type { Element } from '../elems/core'

interface Sizing {
    width?: number
    height?: number
    aspect?: number
}

interface LayoutOffer {
    width?: number       // exact allocation
    height?: number
    maxWidth?: number    // available space, not a promise that content fits
    maxHeight?: number
    attrs?: Attrs       // inherited typography
}

type LayoutResult = { elem: Element, em: EmSpec }
type RowAlign = 'top' | 'anchor' | 'center' | 'bottom'
type Overflow = 'visible' | 'clip' | 'shrink' | 'error'

interface PackOptions {
    direc?: Orient
    width?: number
    height?: number
    maxWidth?: number
    maxHeight?: number
    gap?: number
    justify?: AlignValue
    valign?: RowAlign
    anchor?: 'first' | 'center'
    overflow?: Overflow
}

export type { Sizing, LayoutOffer, LayoutResult, RowAlign, Overflow, PackOptions }
