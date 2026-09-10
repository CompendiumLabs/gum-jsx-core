// common types

// basic geometry
type Point = [number, number]
type Rect = [number, number, number, number]
type Limit = [number, number]
type Size = [number, number]
type Grad = [number, number]
type Polar = [number | Size, number]
type Complex = [number, number]
type Pair = Point | Size | Limit | Grad | Complex
type Vector = number[]

// color
type RGBA = [number, number, number, number]

// metaposition: a location value optionally paired with a pixel offset
type MNumber = [number, number]
type MPoint = [MNumber, MNumber]

// alignment: named position or fractional 0-1
type Zone = 'inner' | 'outer' | 'both' | 'none'
type AlignValue = Side | 'center' | 'middle' | 'stretch' | number   // stretch: take the slot across a stack (a column's width, a row's height) when the element can
type Align = AlignValue | [AlignValue, AlignValue]

// direction: horizontal/vertical, cardinal, angle in degrees, or unit vector
type Orient = 'h' | 'v'
type Side0 = 't' | 'b' | 'l' | 'r'
type Side = Side0 | 'left' | 'right' | 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west' | 'n' | 's' | 'e' | 'w'
type Angle = number
type Direc = Side | Angle | Grad

// padding/margin: number, point, or [p0, p1, p2, p3]
type PaddingValue = number | Point
type Padding = boolean | PaddingValue | [PaddingValue, PaddingValue, PaddingValue, PaddingValue]

// rectangle rounding in stroke units: number, x/y pair, or four corners
type RoundedValue = number | Point
type Rounded = boolean | RoundedValue | [RoundedValue, RoundedValue, RoundedValue, RoundedValue]

// element args: the common pattern for component constructors
type Attrs = Record<string, any>

// layout spec: the keys extracted by spec_split
type Spec = {
    rect?: Rect
    coord?: Rect
    aspect?: number
    aspect0?: number
    expand?: boolean
    align?: Align
    upright?: boolean
    rotate?: number
    rotate_invar?: boolean
    rotate_adjust?: boolean
    width?: number    // a size of its own, in its em (see Element.bounds)
    height?: number
    share?: number    // its fraction of a stack's length along the axis
    fit?: boolean     // scaled to its slot like a figure (an element with metrics)
    offer?: { width?: number, height?: number }   // internal: the offer a container is rebuilt for
    em?: number       // a group's coordinate units per em, given or from the box it is laid in (see Group.place)
}

// command line arguments
type ThemeName = 'light' | 'dark'
type OutputFormat = 'json' | 'svg' | 'png' | 'kitty' | 'layout'
type LoadFileData = string | Uint8Array
type LoadFile = (path: string, encoding?: string) => LoadFileData

interface CliArgs {
  file?: string
  output?: string
  format: OutputFormat
  theme: ThemeName
  background?: string
  size?: Size
  unitSize?: number
  rasterSize?: Size
  dev: boolean
  strict: boolean
  seed?: number
  zoom?: Rect
  depth?: number
  select?: string
  loadFile: LoadFile
}


export type { Point, Rect, Limit, Size, Grad, Polar, Complex, Pair, Vector, RGBA, MNumber, MPoint, AlignValue, Align, Zone, Side, Side0, Orient, Angle, Direc, RoundedValue, Padding, Rounded, Attrs, Spec, ThemeName, OutputFormat, LoadFileData, LoadFile, CliArgs }
