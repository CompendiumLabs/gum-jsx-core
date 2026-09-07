// gum.js

import './types/opentype.d.ts'
import './types/linebreak.d.ts'

import { sans, mono, moji, cmoji, light, regular, bold, none, black, white, gray, blue, red, green, yellow, purple, lightgray, darkgray, slate, e, pi, phi, r2d, d2r } from './lib/const'
import { is_scalar, is_string, is_boolean, is_object, is_function, is_array, zip, reshape, split, concat, slice, sum, prod, mean, cumsum, norm, range, linspace, enumerate, repeat, meshgrid, lingrid, exp, log, log10, sin, cos, tan, abs, pow, sqrt, sign, floor, ceil, round, atan, atan2, minimum, maximum, min, max, clamp, rescale, normalize, sigmoid, logit, smoothstep, setSeed, random, uniform, normal, integer, interp, palette, polar, polard, rounder, add2, sub2, mul2, div2, addn, subn, muln, divn, addc, subc, mulc, divc, conjc, normc, argc } from './lib/utils'
import { FontRegistry, FontNotLoadedError, TEXT_FONTS, loadTextFonts } from './fonts/fonts'
import { Env, corePlugin, CORE_ELEMS, bindConstructor, defaultEnv, setDefaultEnv } from './env'
import { is_emoji } from './lib/text'

import { Context, Element, Group, Svg, Rectangle, Spacer, is_element } from './elems/core'
import { Box, Frame, Stack, VStack, HStack, HWrap, Grid, Points, Anchor, Attach, Absolute } from './elems/layout'
import { Line, UnitLine, VLine, HLine, CoordLine, Segments, Square, Ellipse, Arc, Circle, Dot, Ray, Polygon, Triangle, Fill, Path, Command, MoveCmd, LineCmd, ArcCmd, CornerCmd, RoundedCornerCmd, CubicSplineCmd, Spline, RoundedRect, RoundedLine, ArrowHead, Arrow } from './elems/geometry'
import { spline1d, spline2d } from './lib/interp'
import { Span, TextLine, Text, Verbatim, TextCol, TextRow, TextGrid, TextFigure, TextBox, TextFrame, Bullets, Bold, Italic } from './elems/text'
import { Node, Edge, Network } from './elems/network'
import { SymPoints, SymLine, SymSpline, SymPoly, SymFill, Field, SymField } from './elems/symbolic'
import { Bar, VBar, HBar, Bars, VBars, HBars, Scale, VScale, HScale, Label, HLabel, VLabel, Labels, HLabels, VLabels, Axis, HAxis, VAxis, OuterLabel, Mesh, HMesh, VMesh, Mesh2D, Graph, Plot, BarPlot, Legend } from './elems/plot'
import { LabelBox, TitleBox, TitleFrame, Slide } from './elems/slide'
import { PngImage, SvgImage, calcPngAspect } from './elems/image'
import { parseTable } from './lib/table'
import { validateZoom, zoomRect, zoomSvg, layoutRows, layoutSvg, LAYOUT_DEPTH } from './inspect'

const Rect = Rectangle

// the default Env: what evaluateGum and elements constructed without an
// explicit `env` use; `gum.use(plugin)` adds an add-on to it
const gum = defaultEnv()

export {
    Env, gum, corePlugin, CORE_ELEMS, bindConstructor, defaultEnv, setDefaultEnv, Context,
    FontRegistry, FontNotLoadedError, TEXT_FONTS, loadTextFonts, calcPngAspect, parseTable,
    validateZoom, zoomRect, zoomSvg, layoutRows, layoutSvg, LAYOUT_DEPTH,
    is_string, is_boolean, is_array, is_object, is_function, is_element, is_scalar, is_emoji,
    e, pi, phi, r2d, d2r, none, white, black, blue, red, green, yellow, purple, gray, lightgray, darkgray, slate, sans, mono, moji, cmoji, light, regular, bold,
    range, linspace, enumerate, repeat, meshgrid, lingrid, zip, reshape, split, concat, slice, sum, prod, mean, cumsum, min, max, minimum, maximum, norm, clamp, rescale, normalize, exp, log, log10, sin, cos, tan, abs, pow, sqrt, sign, floor, ceil, round, atan, atan2, sigmoid, logit, smoothstep, polar, polard, rounder, interp, palette, add2, sub2, mul2, div2, addn, subn, muln, divn, addc, subc, mulc, divc, conjc, normc, argc, spline1d, spline2d,
    setSeed, random, uniform, normal, integer,
    Element, Group, Svg, Box, Frame, Stack, HWrap, VStack, HStack, Grid, Points, Anchor, Attach, Absolute, Spacer, Ray, Line, UnitLine, HLine, VLine, CoordLine, Segments, Rectangle, Rect, RoundedRect, RoundedLine, Square, Ellipse, Arc, Circle, Dot, Polygon, Path, Spline, Triangle, Fill, Arrow, Field, Span, TextLine, Text, Verbatim, TextCol, TextRow, TextGrid, TextFigure, TextBox, TextFrame, Bullets, Bold, Italic, LabelBox, TitleBox, TitleFrame, ArrowHead, Node, Edge, Network, SymPoints, SymLine, SymSpline, SymPoly, SymFill, SymField, Bar, VBar, HBar, Bars, VBars, HBars, Scale, VScale, HScale, Label, HLabel, VLabel, Labels, HLabels, VLabels, Axis, HAxis, VAxis, OuterLabel, Mesh, HMesh, VMesh, Mesh2D, Graph, Plot, BarPlot, Legend, Slide, PngImage, SvgImage,
    Command, MoveCmd, LineCmd, ArcCmd, CornerCmd, RoundedCornerCmd, CubicSplineCmd,
}

export type { ElementConstructor, Bindings, EnvPlugin, EnvSettings, EnvArgs, EvaluateArgs, PreludeArgs } from './env'
export type { FontPath, FontFace, FontPlugin } from './fonts/fonts'
export type { ThemeName } from './lib/theme'
export type { SplineFuncArgs } from './lib/interp'
export type { PngImageArgs, SvgImageArgs } from './elems/image'
export type { Zoom, LayoutOptions, LayoutRow } from './inspect'
export type { Sizing, LayoutOffer, LayoutResult, Overflow } from './lib/layout'

export type * from './lib/types'
