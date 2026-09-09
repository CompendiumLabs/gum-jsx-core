// wrapping utilities that avoid text/font dependencies

// when measure is null, that means mandatory line break (but zero width)
function wrap_widths<T>(objects: T[], measure: (obj: T) => number | undefined, maxWidth?: number): { rows: T[][], widths: number[] } {
    // return values
    const rows: T[][] = []
    const widths: number[] = []

    // line accumulation
    let buffer: T[] = []
    let width = 0

    // iterate over sizes
    for (const object of objects) {
        const size = measure(object)
        if (size == null) {
            // mandatory new line
            rows.push(buffer)
            widths.push(width)
            buffer = []
            width = 0
        } else if (maxWidth != null && width + size > maxWidth) {
            // start a new line, but avoid emitting an empty row
            // when the first token is itself wider than maxWidth
            if (buffer.length > 0) {
                rows.push(buffer)
                widths.push(width)
            }
            buffer = [ object ]
            width = size
        } else {
            // append to current line
            buffer.push(object)
            width = width + size
        }
    }

    // add any remaining buffer
    if (buffer.length > 0) {
        rows.push(buffer)
        widths.push(width)
    }

    // return rows and widths
    return { rows, widths }
}

export { wrap_widths }
