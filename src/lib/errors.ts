// evaluation errors with source positions
//
// evaluated code runs in a `new Function` body whose source is the user's
// code with its jsx spliced out line for line (see parse.ts) and a
// `//# sourceURL` naming it, so the engine's stack frames for user code carry
// that name and line numbers that map back to the source by a fixed offset.
// `ErrorRuntime.from` reads them out of a thrown error's stack, together with
// the jsx elements that were being built (recorded by `addSite` as the error
// unwinds through the element constructor calls) and the element constructors
// on the stack, into a report a host can format or point an editor at.

//
// stack parsing
//

// one frame of an engine stack trace
type StackFrame = {
    name: string | null      // function name (without a `new ` prefix)
    file: string | null
    line: number | null
    column: number | null
    construct: boolean       // a constructor call (v8 only, others report false)
}

// v8 (chrome, node, bun): `    at name (file:line:col)`, `    at file:line:col`, `    at new Name (file:line:col)`
const V8_FRAME = /^\s*at\s+(?:(new\s+)?(.*?)\s+\()?(.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/
// spidermonkey and javascriptcore (firefox, safari): `name@file:line:col`, `@file:line:col`
const JSC_FRAME = /^(.*?)@(.*?)(?::(\d+))?(?::(\d+))?$/

function parseFrame(text: string): StackFrame | null {
    const v8 = text.match(V8_FRAME)
    if (v8 != null) {
        const [ , ctor, name, file, line, column ] = v8
        return {
            name: (name != null && name.length > 0) ? name : null,
            file: file.length > 0 ? file : null,
            line: line != null ? Number(line) : null,
            column: column != null ? Number(column) : null,
            construct: ctor != null,
        }
    }
    const jsc = text.match(JSC_FRAME)
    if (jsc != null) {
        const [ , name, file, line, column ] = jsc
        return {
            name: name.length > 0 ? name : null,
            file: file.length > 0 ? file : null,
            line: line != null ? Number(line) : null,
            column: column != null ? Number(column) : null,
            construct: false,
        }
    }
    return null
}

// the frames of an error's stack string, innermost first (lines that are not
// frames, such as v8's leading `Name: message`, are dropped)
function parseStack(stack: string | undefined): StackFrame[] {
    if (stack == null) return []
    const frames: StackFrame[] = []
    for (const line of stack.split('\n')) {
        if (line.trim().length == 0) continue
        const frame = parseFrame(line)
        if (frame != null && (frame.line != null || frame.file != null)) frames.push(frame)
    }
    return frames
}

//
// function source offsets
//

const PROBE_NAME = 'gum-probe.jsx'

// the number of lines an engine puts before the body of a `new Function`
// (`function anonymous(args\n) {\n` is two on v8, jsc and spidermonkey),
// measured once by throwing from a body whose first line is known
let functionOffset: number | null = null
function functionLineOffset(): number {
    if (functionOffset != null) return functionOffset
    functionOffset = 2
    try {
        new Function(`throw new Error('probe')\n//# sourceURL=${PROBE_NAME}`)()
    } catch (err: any) {
        const frame = parseStack(err?.stack).find(f => f.file == PROBE_NAME)
        if (frame?.line != null) functionOffset = frame.line - 1
    }
    return functionOffset
}

//
// element sites
//

// a jsx element that was being constructed when an error was thrown
type ErrorSite = {
    element: string   // the tag as written
    line: number      // source line of the element
}

const SITES = Symbol('gum.sites')

// record the element site an error is unwinding through (innermost first)
function addSite(err: unknown, site: ErrorSite): void {
    if (err == null || (typeof err != 'object' && typeof err != 'function')) return
    const holder = err as Record<symbol, ErrorSite[]>
    holder[SITES] ??= []
    holder[SITES].push(site)
}

function getSites(err: unknown): ErrorSite[] {
    if (err == null || (typeof err != 'object' && typeof err != 'function')) return []
    return (err as Record<symbol, ErrorSite[]>)[SITES] ?? []
}

//
// error classes
//

// the code could not be parsed (or the engine rejected the transformed code,
// in which case there is no position)
class ErrorSyntax extends Error {
    line: number | null
    column: number | null

    constructor(message: string, line: number | null = null, column: number | null = null) {
        super(message)
        this.name = 'ErrorSyntax'
        this.line = line
        this.column = column
    }

    // where it happened, as text
    traceback(): string {
        if (this.line == null) return ''
        return this.column != null ? `  line ${this.line}, column ${this.column}` : `  line ${this.line}`
    }
}

// a frame of user code, with its line in the source
type SourceFrame = {
    name: string | null    // enclosing function, null at the top level
    line: number
    column: number | null  // column in the transformed line (exact only on lines without jsx)
}

type RuntimeArgs = {
    name: string                   // the sourceURL the code ran under
    header: number                 // lines the wrapper adds before the source
    lines: number                  // lines in the source
    scope?: Record<string, any>    // the globals the code ran with, to spot element constructors
    wrapper?: string               // the wrapper function name, whose frames are top level code
}

// is a scope entry a class (an element constructor, bound or not)?
function isConstructor(value: any): boolean {
    if (typeof value != 'function' || value.prototype == null) return false
    const desc = Object.getOwnPropertyDescriptor(value, 'prototype')
    return desc != null && desc.writable === false
}

// the code threw while running
class ErrorRuntime extends Error {
    kind: string                // the original error's name (TypeError, ReferenceError, ...)
    cause: unknown              // the original error
    frames: SourceFrame[]       // user code frames, innermost first
    sites: ErrorSite[]          // jsx elements being built, innermost first
    trail: string[]             // element constructors on the stack, innermost first
    line: number | null         // the source line to point at, if any
    column: number | null

    constructor(cause: unknown, frames: SourceFrame[] = [], sites: ErrorSite[] = [], trail: string[] = []) {
        const error = cause instanceof Error ? cause : null
        super(error?.message ?? String(cause))
        this.name = 'ErrorRuntime'
        this.kind = error?.name ?? 'Error'
        this.cause = cause
        this.frames = frames
        this.sites = sites
        this.trail = trail
        const where = frames[0] ?? sites[0] ?? null
        this.line = where?.line ?? null
        this.column = frames[0]?.column ?? null
        this.stack = `${this.kind}: ${this.message}\n${this.traceback()}`
    }

    // read the report out of a thrown error
    static from(cause: unknown, { name, header, lines, scope = {}, wrapper }: RuntimeArgs): ErrorRuntime {
        if (cause instanceof ErrorRuntime) return cause
        const error = cause instanceof Error ? cause : null
        const stack = parseStack(error?.stack)
        const offset = header + functionLineOffset()

        // user frames: those in the named source, mapped back to source lines
        const frames: SourceFrame[] = []
        for (const frame of stack) {
            if (frame.file != name || frame.line == null) continue
            const line = frame.line - offset
            if (line < 1 || line > lines) continue
            const func = (frame.name == null || frame.name == wrapper) ? null : frame.name.replace(/^<anonymous>$/, 'anonymous')
            frames.push({ name: func, line, column: frame.column })
        }

        // element trail: constructors of scope elements on the stack
        const trail: string[] = []
        for (const frame of stack) {
            if (frame.name == null || frame.file == name) continue
            const base = frame.name.split('.').pop() ?? frame.name
            if (isConstructor(scope[base]) && trail[trail.length - 1] != base) trail.push(base)
        }

        return new ErrorRuntime(cause, frames, getSites(cause), trail)
    }

    // where it happened, as text: one line per user frame (labelled with the
    // element built there when one was), then the element chain
    traceback(): string {
        const out: string[] = []
        const sites = [ ...this.sites ]
        for (const { name, line } of this.frames) {
            const site = sites[0]?.line == line ? sites.shift() : null
            const label = site != null ? `<${site.element}>` : name != null ? `${name}()` : 'top level'
            out.push(`  line ${line}  in ${label}`)
        }
        for (const { element, line } of sites) {
            out.push(`  line ${line}  in <${element}>`)
        }
        // the chain of element constructors, unless it is just the element built at the site
        const { trail } = this
        if (trail.length > 1 || (trail.length == 1 && trail[0] != this.sites[0]?.element)) {
            out.push(`  while constructing ${[ ...trail ].reverse().join(' > ')}`)
        }
        return out.join('\n')
    }
}

export { parseStack, functionLineOffset, addSite, getSites, ErrorSyntax, ErrorRuntime }
export type { StackFrame, SourceFrame, ErrorSite }
