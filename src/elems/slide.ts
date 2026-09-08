// slide elements

import { THEME } from '../lib/theme'
import { DEFAULTS as D, black, white, none } from '../lib/const'
import { prefix_split, pad_rect } from '../lib/utils'

import { spec_split, align_frac, is_element, ensure_children, Rectangle, Group } from './core'
import { Attach } from './layout'
import { Box, TextFrame, box_insets } from './box'
import { RoundedRect } from './geometry'
import { Span, TextCol } from './text'

import type { AlignValue, Padding, Rounded, Point, Rect } from '../lib/types'
import type { Element } from './core'
import type { BoxArgs, BoxGeometry } from './box'

//
// title/slide classes
//

interface LabelBoxArgs extends BoxArgs {
    label?: Element | string
}

class LabelBox extends Box {
    constructor(args: LabelBoxArgs = {}) {
        const { children: children0, label: label0, env, ...attr0 } = THEME(args, 'LabelBox')
        const [ label_attr, attr1 ] = prefix_split(['label'], attr0)
        const [ spec, attr ] = spec_split(attr1)
        const children = ensure_children(children0)

        // enclose children in a box
        const inner = new Box({ children, env, ...attr })

        // make optional label box
        let attach: Attach | null = null
        if (label0 != null) {
            const label = is_element(label0) ? label0 : new Span({ children: [ label0 ], env })
            attach = new Attach({ children: [ label ], rect: D.rect, env, ...label_attr })
        }

        // pass layout spec to the outer box, not the inner box
        super({ children: [ inner, attach ], env, ...spec })
        this.args = args
    }
}

interface TitleBoxArgs extends BoxArgs {
    title?: Element | string
    title_scale?: number      // the title's em over the box's
    title_fill?: string
    title_rounded?: Rounded
    title_padding?: Padding   // in em of the title
}

const TITLE_PADDING: Padding = [ 0.6, 0.3 ]

// a box with a title on its top border: a TextFrame at its own size (one em,
// or `title-scale`) centered on the border, the frame cut behind it; the
// box's margin makes room for its top half
class TitleBox extends Box {
    constructor(args: TitleBoxArgs = {}) {
        const { children, title, title_scale = 1, title_rounded = D.rounded, title_padding = TITLE_PADDING, title_fill, margin, env, ...attr0 } = THEME(args, 'TitleBox')
        const [ title_attr, attr1 ] = prefix_split([ 'title' ], attr0)
        const [ spec, attr ] = spec_split(attr1)

        // the title box, and the mask that cuts the frame behind it (in the
        // inner box's em: the frame's top edge is its y = 0)
        let title_box: TextFrame | null = null
        let title_mask: ((g: BoxGeometry) => Element) | undefined
        let half = 0
        if (title != null) {
            const title_span = is_element(title) ? title : new Span({ children: [ title ], env })
            title_box = new TextFrame({ children: [ title_span ], pos: [ 0.5, 0 ], scale: title_scale, rounded: title_rounded, padding: title_padding, fill: title_fill, env, ...title_attr })
            const { width: tw, height: th } = title_box.em
            half = th / 2
            title_mask = ({ total_w, total_h, box_w, ml, mt }) => new Group({ children: [
                new Rectangle({ rect: [ -total_w, -total_h, 2 * total_w, 2 * total_h ], fill: white, env }),
                new RoundedRect({ rect: [ ml + box_w / 2 - tw / 2, mt - th / 2, ml + box_w / 2 + tw / 2, mt + th / 2 ], rounded: title_rounded, fill: black, env }),
            ], fill_rule: 'evenodd', env })
        }

        // the inner box holds the content and draws the frame, its top padding
        // at least the title's lower half; with a shape of its own (aspect or
        // flex) it fills the outer rather than hugging
        const sized = spec.flex === true || spec.aspect != null
        const [ pl, pt, pr, pb ] = box_insets(attr.padding, 0.5)
        const box = new Box({ children, mask: title_mask, flex: sized, env, ...attr, padding: [ pl, Math.max(pt, half + 0.2), pr, pb ] })

        // pass to Box: the margin outside, its top at least the title's half
        const [ ml0, mt0, mr0, mb0 ] = box_insets(margin, 0.5)
        super({ children: [ box, title_box ], margin: [ ml0, Math.max(mt0, half), mr0, mb0 ], env, ...spec })
        this.args = args
    }
}

interface TitleFrameArgs extends TitleBoxArgs {
    border?: number
}

class TitleFrame extends TitleBox {
    constructor(args: TitleFrameArgs = {}) {
        const { border = 1, ...attr } = THEME(args, 'TitleFrame')
        super({ border, ...attr })
        this.args = args
    }
}

interface SlideArgs extends Omit<TitleFrameArgs, 'aspect'> {
    aspect?: number | 'auto'
    title_size?: number   // the title box's height as a fraction of the frame's
    padding?: Padding
    margin?: Padding
    rounded?: Rounded
    border_stroke?: string
    background?: string
    width?: number
    em?: number
    gap?: number
    justify?: AlignValue
    align?: AlignValue
    valign?: AlignValue
    overflow?: 'shrink' | 'clip' | 'error'
}

// a slide is a fixed-aspect canvas (16:9 by default) holding a TitleFrame that
// fills it inside the margin; margin and padding are fractions of the slide
// height, so they are the same distance in every direction. the content is a
// TextCol of the children in the frame's padded area. its text size is set by
// `em`, the em as a fraction of the slide height (so 0.05 fits twenty lines),
// or else by `width`, the content width in em; either way the column spans the
// content width. content taller than the area is shrunk to fit it, clipped,
// or an error, by `overflow`; the `overflow` property is the ratio of content
// height to the area's, so more than 1 means it did not fit
class Slide extends Group {
    // ratio of content height to the available height (> 1 means it was shrunk)
    overflow: number

    constructor(args: SlideArgs = {}) {
        const {
            children, aspect: aspect0 = 16 / 9, padding = 0.1, margin = 0.1, border = 1, rounded = D.rounded,
            border_stroke = '#bbb', background, title_size = 0.1, width: width0 = 25, em, gap = 0.5,
            justify = 'left', align = 'center', valign = 'center', overflow: mode = 'shrink', env, ...attr0
        } = THEME(args, 'Slide')
        const [ text_attr, attr1 ] = prefix_split([ 'text' ], attr0)
        const [ spec, attr ] = spec_split(attr1)
        const [ ml, mt, mr, mb ] = pad_rect(margin)
        const [ pl, pt, pr, pb ] = pad_rect(padding)

        // the content area, in slide heights: inside the margin and the frame's padding
        const aspect = aspect0 == 'auto' ? undefined : aspect0
        const area_height = 1 - mt - mb - pt - pb
        const area_width0 = aspect != null ? aspect - ml - mr - pl - pr : undefined
        if (area_height <= 0 || (area_width0 != null && area_width0 <= 0)) throw new Error('Slide padding and margin leave no room for content')

        // the content column: `em` sets its width from the area, else `width` is
        // it; with a fixed aspect the area's height in em is known too, and the
        // column budgets it to any figures it holds
        const width = (em != null && area_width0 != null) ? area_width0 / em : width0
        const height = area_width0 != null ? width * area_height / area_width0 : undefined
        const col = new TextCol({ children, width, height, gap, justify, env, ...text_attr })
        const { width: col_width, height: col_height } = col.em

        // an auto aspect fits the canvas to the content
        const canvas_aspect = aspect ?? (col_width / Math.max(col_height, 1e-9)) * area_height + ml + mr + pl + pr
        const area_width = area_width0 ?? canvas_aspect - ml - mr - pl - pr

        // the column spans the area's width, so this many slide heights make an
        // em; the ratio of its height to the area's is the overflow
        const em_size = area_width / col_width
        const ratio = col_height * em_size / area_height
        if (mode == 'error' && ratio > 1) throw new Error(`Slide content overflows its frame by ${Math.round((ratio - 1) * 100)}%`)

        // place the column in the area: at its size, aligned, unless it must
        // shrink to fit the height
        const shrink = mode == 'shrink' && ratio > 1
        const v = align_frac(valign)
        const u = align_frac(align)
        const rect: Rect = shrink
            ? [ u * (1 - 1 / ratio), 0, u * (1 - 1 / ratio) + 1 / ratio, 1 ]
            : [ 0, v * (1 - ratio), 1, v * (1 - ratio) + ratio ]
        const area = new Group({ children: [ col.clone({ rect }) ], aspect: area_width / area_height, clip: mode == 'clip' ? true : undefined, env })

        // the frame fills the canvas inside the margin, laid out in the
        // slide's em with its padding (in slide heights) in em
        const frame_width = canvas_aspect - ml - mr
        const frame_height = 1 - mt - mb
        const title_scale = (title_size * frame_height / em_size) / (1 + 2 * pad_rect(TITLE_PADDING)[1])
        const frame0 = new TitleFrame({
            children: [ area ], aspect: frame_width / frame_height, padding: [ pl, pt, pr, pb ].map(p => p / em_size) as Rect,
            border, rounded, border_stroke, title_scale, env, ...attr,
        })
        const frame = frame0.lay({ width: frame_width / em_size, height: frame_height / em_size }).elem.clone({ rect: [ ml, mt, canvas_aspect - mr, 1 - mb ] })

        // the canvas is the slide itself
        const backdrop = background != null ? new Rectangle({ fill: background, stroke: none, env }) : null
        super({ children: [ backdrop, frame ], coord: [ 0, 0, canvas_aspect, 1 ], aspect: canvas_aspect, env, ...spec })
        this.args = args
        this.overflow = ratio
    }
}

//
// exports
//

export { LabelBox, TitleBox, TitleFrame, Slide }
export type { LabelBoxArgs, TitleBoxArgs, TitleFrameArgs, SlideArgs }
