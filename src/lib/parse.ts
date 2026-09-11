// jsx transform and runner
//
// the code is parsed with acorn (plus acorn-jsx) and only its jsx ranges are
// rewritten, into `__COMPONENT__(Tag, "Tag", line, props, ...children)` calls
// that keep every newline of the range they replace; everything else is the
// source verbatim. the code that runs therefore has the source's line numbers,
// which is what lets an error point back at a line (see errors.ts).

import * as acorn from 'acorn'
import jsx from 'acorn-jsx'
import { ErrorSyntax, ErrorRuntime, addSite } from './errors'

//
// parsing
//

type ASTNode = acorn.Node & Record<string, any>

const parser = acorn.Parser.extend(jsx())

// parse gum.jsx code; a `return` at the top level is allowed since the code
// runs as a function body
function parseJSX(code: string): ASTNode {
    try {
        return parser.parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            locations: true,
            allowReturnOutsideFunction: true,
        }) as ASTNode
    } catch (err: any) {
        // acorn appends the position to the message and puts it in `loc` (zero based column)
        const loc = err?.loc
        if (err instanceof SyntaxError && loc != null) {
            const message = err.message.replace(/\s*\(\d+:\d+\)$/, '')
            throw new ErrorSyntax(message, loc.line, loc.column + 1)
        }
        throw err
    }
}

//
// transform
//

// a piece of emitted code, with the source range it stands for
type Piece = {
    start: number
    end: number
    text: string
}

function isWhitespace(s: any): boolean {
    return (typeof s === 'string') && (s.replace(/\s/g, '') === '')
}

function isJSX(node: ASTNode | null): boolean {
    return node != null && (node.type == 'JSXElement' || node.type == 'JSXFragment')
}

function snakeCase(s: string): string {
    return s.replace(/-/g, '_')
}

function countNewlines(code: string, from: number, to: number): number {
    let count = 0
    for (let i = from; i < to; i++) {
        if (code.charCodeAt(i) == 10) count++
    }
    return count
}

// the jsx nodes under a node that are not nested inside other jsx, in source order
function jsxRoots(node: any, out: ASTNode[]): void {
    if (node == null || typeof node != 'object') return
    if (Array.isArray(node)) {
        for (const item of node) jsxRoots(item, out)
        return
    }
    if (typeof node.type != 'string') return
    if (isJSX(node)) {
        out.push(node)
        return
    }
    for (const key of Object.keys(node)) {
        if (key == 'type' || key == 'start' || key == 'end' || key == 'loc') continue
        jsxRoots(node[key], out)
    }
}

// the source of a node with the jsx inside it transformed
function transformNode(code: string, node: ASTNode): string {
    const roots: ASTNode[] = []
    jsxRoots(node, roots)
    roots.sort((a, b) => a.start - b.start)
    let out = ''
    let pos = node.start
    for (const root of roots) {
        out += code.slice(pos, root.start) + emitJSX(code, root)
        pos = root.end
    }
    return out + code.slice(pos, node.end)
}

// a jsx attribute as an object literal entry
function emitAttribute(code: string, attr: ASTNode): string {
    if (attr.type == 'JSXSpreadAttribute') {
        return `...${transformNode(code, attr.argument)}`
    }
    const { name, value } = attr
    const key = JSON.stringify(snakeCase(code.slice(name.start, name.end)))
    if (value == null) return `${key}: true`
    // jsx string attributes are raw (no escape processing), unlike js literals
    if (value.type == 'Literal') return `${key}: ${JSON.stringify(value.value)}`
    if (value.type == 'JSXExpressionContainer') return `${key}: ${transformNode(code, value.expression)}`
    return `${key}: ${emitJSX(code, value)}`
}

// a jsx child as an argument, or null for one that is dropped (whitespace, comments)
function emitChild(code: string, child: ASTNode): string | null {
    switch (child.type) {
        case 'JSXText':
            return isWhitespace(child.value) ? null : JSON.stringify(child.value)
        case 'JSXExpressionContainer':
            if (child.expression.type == 'JSXEmptyExpression') return null
            return transformNode(code, child.expression)
        case 'JSXSpreadChild':
            return `...${transformNode(code, child.expression)}`
        default:
            return emitJSX(code, child)
    }
}

// lay pieces out after a position, carrying over the newlines of the source
// between and inside them so the emitted code keeps the source's lines
function layout(code: string, pieces: Piece[], from: number, to: number, join: string): string {
    let out = ''
    let pos = from
    for (const [ index, piece ] of pieces.entries()) {
        const gap = '\n'.repeat(countNewlines(code, pos, piece.start))
        const inner = countNewlines(code, piece.start, piece.end) - countNewlines(piece.text, 0, piece.text.length)
        const pad = '\n'.repeat(Math.max(0, inner))
        out += (index > 0 ? join : '') + gap + piece.text + pad
        pos = piece.end
    }
    return out + '\n'.repeat(countNewlines(code, pos, to))
}

function childPieces(code: string, children: ASTNode[]): Piece[] {
    const pieces: Piece[] = []
    for (const child of children) {
        const text = emitChild(code, child)
        if (text != null) pieces.push({ start: child.start, end: child.end, text })
    }
    return pieces
}

// a jsx element or fragment as a component call (or array), spanning the same lines
function emitJSX(code: string, node: ASTNode): string {
    if (node.type == 'JSXFragment') {
        const kids = childPieces(code, node.children)
        return `[${layout(code, kids, node.start, node.end, ', ')}]`
    }

    const { openingElement, children } = node
    const { name, attributes } = openingElement
    const tag = code.slice(name.start, name.end)
    const line = node.loc!.start.line

    // props object, then children, in source order
    const props: Piece[] = attributes.map((attr: ASTNode) => ({ start: attr.start, end: attr.end, text: emitAttribute(code, attr) }))
    const kids = childPieces(code, children)
    const propsEnd = props.length > 0 ? props[props.length - 1].end : name.end
    const kidsEnd = kids.length > 0 ? kids[kids.length - 1].end : propsEnd

    const head = `__COMPONENT__(${tag}, ${JSON.stringify(tag)}, ${line}, {`
    const body = layout(code, props, name.end, propsEnd, ',')
    const tail = kids.length > 0 ? `, ${layout(code, kids, propsEnd, kidsEnd, ', ')}` : ''
    const rest = '\n'.repeat(countNewlines(code, kidsEnd, node.end))
    return `${head}${body}}${tail}${rest})`
}

//
// runner
//

// a class has a non-writable prototype, a plain function a writable one and an
// arrow function none (an Env-bound element constructor is a Proxy over the
// class, so the prototype's own constructor is not consulted)
function isClass(func: any): boolean {
    return (typeof func === 'function') &&
           (func.prototype != null) &&
           (Object.getOwnPropertyDescriptor(func, 'prototype')!.writable === false)
}

function filterChildren(items: any[]): any[] {
    // Formatting-only JSXText is discarded by emitChild. Explicit string
    // expressions must survive, including spaces and blank literal lines.
    return items.flat(Infinity)
        .filter(item => (item != null) && (item !== false) && (item !== true))
}

// what a jsx element compiles to: build the element, and if that throws record
// the element and line on the way out
function component(klass: any, tag: string, line: number, props: Record<string, any>, ...children0: any[]): any {
    const args = { ...props }
    const children = filterChildren(children0)
    if (children.length > 0) args.children = children
    try {
        return isClass(klass) ? new klass(args) : klass(args)
    } catch (err) {
        addSite(err, { element: tag, line })
        throw err
    }
}

const SOURCE_NAME = 'gum.jsx'
const PRELUDE_NAME = 'prelude.jsx'
const WRAPPER = 'run'
const HEADER_LINES = 1  // lines the wrapper puts before the source
const STACK_LIMIT = 200 // deep element trees need more than v8's default ten frames

// the function body: the source inside a named function (so top level
// declarations can shadow the scope names, which are the parameters) and the
// sourceURL that names its frames
function wrapBody(body: string, name: string): string {
    return `return (function ${WRAPPER}() { "use strict";\n${body}\n})()\n//# sourceURL=${name}`
}

// compile and run a function body against `scope` bound as its globals
function runBody(body: string, source: string, name: string, scope: Record<string, any>, debug: boolean): any {
    if (debug) {
        console.log('-------------JS-----------------')
        console.log(body)
        console.log('--------------------------------')
        console.log()
    }

    // construct function (the engine may still reject the transformed code)
    let func: Function
    try {
        func = new Function('__COMPONENT__', ...Object.keys(scope), wrapBody(body, name))
    } catch (err: any) {
        throw new ErrorSyntax(err?.message ?? String(err))
    }

    // execute function with enough stack kept to reach the user frames
    const limit = (Error as any).stackTraceLimit
    if (typeof limit == 'number') (Error as any).stackTraceLimit = Math.max(limit, STACK_LIMIT)
    try {
        return func(component, ...Object.values(scope))
    } catch (err) {
        const lines = countNewlines(source, 0, source.length) + 1
        throw ErrorRuntime.from(err, { name, header: HEADER_LINES, lines, scope, wrapper: WRAPPER })
    } finally {
        if (typeof limit == 'number') (Error as any).stackTraceLimit = limit
    }
}

// run gum.jsx code with `scope` bound as its globals (see Env.scope) and
// return what it evaluates to: the value of a bare jsx element, else what the
// code returns
function runJSX(text: string, scope: Record<string, any> = {}, debug: boolean = false, name: string = SOURCE_NAME): any {
    const tree = parseJSX(text)

    if (debug) {
        console.log('------------TREE----------------')
        console.log(JSON.stringify(tree, null, 2))
        console.log('--------------------------------')
        console.log()
    }

    // a program that is one bare element is returned in place
    const [ first ] = tree.body
    const bare = tree.body.length == 1 && first.type == 'ExpressionStatement' && isJSX(first.expression)
    const body = bare ?
        `${text.slice(0, first.expression.start)}return (${emitJSX(text, first.expression)})${text.slice(first.expression.end)}` :
        transformNode(text, tree)

    return runBody(body, text, name, scope, debug)
}

//
// prelude
//

// collect the names bound by a declaration pattern
function patternNames(node: ASTNode, names: string[]): void {
    if (node.type == 'Identifier') {
        names.push(node.name)
    } else if (node.type == 'ObjectPattern') {
        for (const prop of node.properties) {
            patternNames(prop.type == 'RestElement' ? prop.argument : prop.value, names)
        }
    } else if (node.type == 'ArrayPattern') {
        for (const elem of node.elements) {
            if (elem != null) patternNames(elem, names)
        }
    } else if (node.type == 'RestElement') {
        patternNames(node.argument, names)
    } else if (node.type == 'AssignmentPattern') {
        patternNames(node.left, names)
    }
}

// names declared at the top level of a program
function declaredNames(tree: ASTNode): string[] {
    const names: string[] = []
    for (const node of tree.body) {
        if (node.type == 'VariableDeclaration') {
            for (const decl of node.declarations) patternNames(decl.id, names)
        } else if (node.type == 'FunctionDeclaration' || node.type == 'ClassDeclaration') {
            if (node.id != null) names.push(node.id.name)
        }
    }
    return names
}

// run a prelude of declarations and return its top-level bindings as an
// object, so they can be added to the scope of later code
function runPrelude(text: string, scope: Record<string, any> = {}, debug: boolean = false, name: string = PRELUDE_NAME): Record<string, any> {
    if (text.trim().length == 0) return {}
    const tree = parseJSX(text)
    const names = declaredNames(tree)
    const body = `${transformNode(text, tree)}\nreturn { ${names.join(', ')} };`
    return runBody(body, text, name, scope, debug)
}

export { runJSX, runPrelude, parseJSX }
