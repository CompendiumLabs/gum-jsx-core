// network elements

import { THEME } from '../lib/theme'
import { abs, sub2, mul2, check_singleton, is_string, rect_center, side_direc, prefix_split, join_limits } from '../lib/utils'

import { Context, Element, Group, ensure_children, size_by_em, spec_split } from './core'
import { Arrow } from './geometry'
import { Text } from './text'
import { Frame, TextFrame } from './box'

import type { ElementArgs, GroupArgs } from './core'
import type { WithEm } from './em'
import type { AlignValue, Limit, Padding, Point, Rounded, Side } from '../lib/types'

//
// cardinal direction utils
//

function get_side(p1: Point, p2: Point): Side {
    const [ dx, dy ] = sub2(p2, p1)
    const [ ax, ay ] = [ abs(dx), abs(dy) ]
    const direc = (dy <= -ax) ? 't' :
                  (dy >=  ax) ? 'b' :
                  (dx <= -ay) ? 'l' :
                  (dx >=  ay) ? 'r' :
                  undefined // should never happen
    return direc as Side
}

//
// node class
//

interface NodeArgs extends GroupArgs {
    id?: string
    em?: number
    ysize?: number
    rounded?: Rounded
    padding?: Padding
    border?: number | boolean
    fill?: string
    width?: number
    justify?: AlignValue
}

// a node is a framed label at a position. given an `em` (coordinate units
// per em, usually from the Network), the box is sized from the label: a
// TextFrame hugging the text (or an element with metrics) with `padding`
// in em, and the node is its em height times `em` tall, so every
// node in the network shares one text size and a wrapped label makes a
// taller node rather than smaller text. without one it is a Frame of the
// given `ysize`, its `padding` a fraction of the box, and the text is fit
// into it. Rounding uses stroke units in both cases.
class Node extends Group {
    id: string | undefined

    constructor(args: NodeArgs = {}) {
        const { children: children0, id, em, ysize: ysize0, rounded, padding, border = 1, fill, width, justify = 'center', env, ...attr0 } = THEME(args, 'Node')
        const [ text_attr, attr1 ] = prefix_split([ 'text' ], attr0)
        const [ spec, attr ] = spec_split(attr1)
        const child = check_singleton(children0)
        const sized = em != null && (is_string(child) || (child as WithEm).em != null)

        // the box: hugging the label in em, or a frame the label is fit into
        let box: Element
        let ysize = ysize0
        if (sized) {
            const label = is_string(child) ? new Text({ children: [ child ], env, ...text_attr }) : child
            const frame = new TextFrame({ children: [ label ], padding: padding ?? 0.4, rounded: rounded ?? true, border, fill, width, justify, env, ...attr, ...text_attr })
            ysize ??= em! * frame.em.height
            box = frame
        } else {
            const inner = is_string(child) ? new Text({ children: [ child ], width, justify, env, ...text_attr }) : child
            box = new Frame({ children: [ inner ], padding: padding ?? 0.3, rounded: rounded ?? true, border, fill, env, ...attr })
            ysize ??= 0.2
        }

        // pass to Group
        super({ children: [ box ], aspect: box.spec.aspect, ysize, upright: true, env, ...spec })
        this.args = args
        this.id = id
    }
}

//
// edge class
//

interface EdgeArgs extends ElementArgs {
    start?: Element | string
    end?: Element | string
    start_side?: Side
    end_side?: Side
    points?: Point[]
}

class Edge extends Element {
    start: Element | string
    end: Element | string
    start_side?: Side
    end_side?: Side
    start_loc?: number
    end_loc?: number
    points: Point[]

    constructor(args: EdgeArgs = {}) {
        const { start, end, start_side, end_side, start_loc, end_loc, points = [], curve = 2, ...attr } = THEME(args, 'Edge')

        // check for nodes
        if (start == null || end == null) throw new Error('Both `start` or `end` must be provided')

        // pass to Element
        super({ tag: 'g', unary: false, curve, ...attr })
        this.args = args

        // additional props
        this.start = start
        this.end = end
        this.start_side = start_side
        this.end_side = end_side
        this.start_loc = start_loc
        this.end_loc = end_loc
        this.points = points
    }

    svg(ctx: Context): string {
        // check for nodes
        if (is_string(this.start) || is_string(this.end)) throw new Error('Trying to render edge with node IDs')

        // get core attributes
        const attr = super.props(ctx)

        // get mapped node rects
        const start_rect = this.start.rect(ctx)
        const end_rect = this.end.rect(ctx)

        // get mapped node centers
        const start_center = rect_center(start_rect)
        const end_center = rect_center(end_rect)
        const pstart_center = ctx.mapPoint(start_center)
        const pend_center = ctx.mapPoint(end_center)

        // get emanation directions
        const start_side = this.start_side ?? get_side(pstart_center, pend_center)
        const end_side = this.end_side ?? get_side(pend_center, pstart_center)

        // get anchor points and tangent vectors
        const start = this.start.anchor(ctx, start_side, this.start_loc)
        const end = this.end.anchor(ctx, end_side, this.end_loc)
        const start_dir = side_direc(start_side)
        const end_dir = mul2(side_direc(end_side), -1)

        const path = new Arrow({ points: [ start, ...this.points, end ], start_dir: start_dir, end_dir: end_dir, coord: ctx.coord, env: this.env, ...attr })
        return path.svg(ctx)
    }
}

//
// network class
//

interface NetworkArgs extends GroupArgs {
    em?: number
    xlim?: Limit
    ylim?: Limit
}

// a network of nodes and edges (and anything else, placed as in a Graph). an
// `em`, in coordinate units, sets the text size of the whole diagram: it goes
// to the nodes, which size their boxes from their labels, and to the Group,
// which sizes any other child with metrics (a Text label, a formula) placed
// by `pos` without a size of its own
class Network extends Group {
    constructor(args: NetworkArgs = {}) {
        const { children: children0, em, xlim, ylim, coord: coord0, ...attr0 } = THEME(args, 'Network')
        const [ node_attr0, edge_attr, attr ] = prefix_split([ 'node', 'edge' ], attr0)
        const node_attr = em != null ? { em, ...node_attr0 } : node_attr0
        const coord = coord0 ?? join_limits({ h: xlim, v: ylim })

        // size the labels by the em first, so the edges bind to the sized
        // nodes (the Group would size them too, but after the edges are made)
        const children = size_by_em(ensure_children(children0), em)

        // process nodes and make label map
        const nodes = children.filter((c: Element) => c.args.id != null).map((n: Element) => n.clone({ ...node_attr, ...n.args }))
        const nmap = new Map(nodes.map((n: Element) => [ n.args.id, n ]))

        // process children in original order
        const items = children.map((c: any) => {
            if (c instanceof Edge) {
                // create arrow path from edge
                const n1 = nmap.get(c.args.start)
                const n2 = nmap.get(c.args.end)
                return c.clone({ ...edge_attr, ...c.args, start: n1, end: n2, coord })
            } else if (c.args.id != null) {
                // return the already processed node from the map
                return nmap.get(c.args.id)
            } else {
                return c
            }
        })

        // pass to Group
        super({ children: items, coord, em, ...attr })
        this.args = args
    }
}

//
// exports
//

export { Node, Edge, Network }
export type { NodeArgs, EdgeArgs, NetworkArgs }
