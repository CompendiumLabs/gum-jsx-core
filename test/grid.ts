import assert from 'node:assert/strict'
import {
  Grid, TextGrid, Box, Rect, Text, LayoutPass, define_element, evaluate,
  px, em, available, exact, make_request, make_size, make_fragment, finish_size,
} from '../src/index'
import type { GridProps, GridTrack } from '../src/index'

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)
}

const tests: Record<string, () => void> = {
  'equal columns share widths across ragged rows and size rows independently'() {
    const source = new Grid({ columns: 3, column_gap: px(10), row_gap: px(7),
      children: [20, 30, 5, 40, 0].map(height => new Box({ height: px(height) })) })
    const pass = new LayoutPass()
    for (const width of [available(320), exact(320)]) {
      const grid = pass.layout(source, make_request({ width }))
      assert.deepEqual(grid.size, { width: 320, height: 77 })
      assert.deepEqual(grid.children.map(cell => cell.fragment.size.width), [100, 100, 100, 100, 100])
      assert.deepEqual(grid.children.map(cell => cell.offset),
        [{ x: 0, y: 0 }, { x: 110, y: 0 }, { x: 220, y: 0 }, { x: 0, y: 37 }, { x: 110, y: 37 }])
    }
  },

  'natural equal columns use the widest cell while auto columns size independently'() {
    const children = [20, 40, 60].map(width => new Box({ width: px(width), height: px(10) }))
    const pass = new LayoutPass()
    const equal = pass.layout(new Grid({ columns: 2, gap: px(8), children }))
    assert.deepEqual(equal.size, { width: 128, height: 28 })
    assert.equal(equal.children[1].offset.x, 68)
    for (const width of [undefined, available(300), available(80)]) {
      const auto = pass.layout(new Grid({ columns: ['auto', 'auto'], gap: px(8), children }), make_request({ width }))
      assert.deepEqual(auto.size, { width: 108, height: 28 })
      assert.equal(auto.children[1].offset.x, 68)
    }
    const minimum = pass.layout(new Grid({ columns: 2, min_width: px(208), gap: px(8), children }))
    assert.equal(minimum.size.width, 208)
    assert.equal(minimum.children[1].offset.x, 108)
  },

  'explicit tracks mix units and auto sizing with fractions of the width after gaps'() {
    const grid = new LayoutPass().layout(new Grid({ columns: [em(2), 'auto', '25%'], font_size: px(20),
      column_gap: px(10), children: [new Box({ height: px(10) }),
        new Box({ width: px(70), height: px(15) }), new Box({ width: 0.5, height: px(20) })] }),
      make_request({ width: available(240) }))
    assert.deepEqual(grid.size, { width: 185, height: 20 })
    assert.deepEqual(grid.children.map(cell => cell.fragment.size.width), [40, 70, 27.5])
    assert.deepEqual(grid.children.map(cell => cell.offset.x), [0, 50, 130])
    const fractions = new LayoutPass().layout(new Grid({ columns: [0.25, 0.75], column_gap: '10%', row_gap: 0,
      children: [new Box({ height: px(10) }), new Box({ height: px(10) })] }), make_request({ width: exact(200) }))
    assert.deepEqual(fractions.children.map(cell => cell.fragment.size.width), [45, 135])
    assert.equal(fractions.children[1].offset.x, 65)
    const rows = new LayoutPass().layout(new Grid({ columns: 2, width: px(100), height: px(100), row_gap: '20%',
      children: [new Box({ height: px(10) }), new Box({ height: px(15) }), new Box({ height: px(20) })] }))
    assert.equal(rows.children[2].offset.y, 35)
  },

  'text reflows at column widths before row heights and later row positions are chosen'() {
    const text = new Text({ children: 'Each column keeps the same width across rows while paragraphs wrap naturally.' })
    const source = new Grid({ columns: 2, gap: px(8), children: [text, new Box({ height: px(12) }),
      new Box({ height: px(20) }), text] })
    const pass = new LayoutPass(), before = JSON.stringify(source)
    const wide = pass.layout(source, make_request({ width: exact(408) }))
    const narrow_request = make_request({ width: exact(208) })
    const narrow = pass.layout(source, narrow_request)
    assert.ok(narrow.size.height > wide.size.height)
    for (const grid of [wide, narrow]) {
      const first = grid.children[0].fragment
      near(first.size.width, (grid.size.width - 8) / 2)
      near(grid.children[2].offset.y, first.size.height + 8)
      near(grid.size.height, first.size.height * 2 + 8)
      assert.equal(first, grid.children[3].fragment)
      assert.equal(grid.guides.baseline, first.guides.baseline)
      near(grid.guides.last_baseline!, grid.children[3].offset.y + first.guides.last_baseline!)
    }
    assert.equal(pass.layout(source, narrow_request), narrow)
    assert.equal(JSON.stringify(source), before)
  },

  'cell alignment and per-axis overrides position children inside shared tracks'() {
    const grid = new LayoutPass().layout(new Grid({ columns: 2, width: px(200), align: 'center', children: [
      new Box({ width: px(20), height: px(10) }), new Box({ width: px(40), height: px(30), align_self: { x: 'end' } }),
      new Box({ width: px(20), height: px(10), align_self: 0 }), new Box({ width: px(40), height: px(30) }),
    ] }))
    assert.deepEqual(grid.children.map(cell => cell.offset),
      [{ x: 40, y: 10 }, { x: 160, y: 0 }, { x: 0, y: 30 }, { x: 130, y: 30 }])
  },

  'fill respects child sizes and limits while stretch overrides them'() {
    const children = [new Box({ height: px(60) }), new Box({ max_width: px(30), max_height: px(20) }),
      new Box({ width: px(20), height: px(10) })]
    const pass = new LayoutPass()
    const fill = pass.layout(new Grid({ columns: 3, width: px(300), align: 'fill', children }))
    assert.deepEqual(fill.children.map(cell => cell.fragment.size),
      [{ width: 100, height: 60 }, { width: 30, height: 20 }, { width: 20, height: 10 }])
    const stretch = pass.layout(new Grid({ columns: 3, width: px(300), align: 'stretch', children }))
    assert.ok(stretch.children.every(cell => cell.fragment.size.width === 100 && cell.fragment.size.height === 60))
    const own_fill = pass.layout(new Grid({ columns: 2, width: px(200), align: 'start', children: [
      new Box({ height: px(60) }), new Box({ width: 'fill', height: 'fill' }),
    ] }))
    assert.deepEqual(own_fill.children[1].fragment.size, { width: 100, height: 60 })
  },

  'vertical stretch locks widths and never feeds row heights back into references'() {
    const references: unknown[] = []
    const Probe = define_element('Probe', (_, query) => {
      references.push(query.measure.reference)
      return make_fragment({ size: finish_size(make_size(20, 10), query.request, query.sizing) })
    })
    const grid = new LayoutPass().layout(new Grid({ columns: 3, width: px(300), align: { y: 'stretch' }, children: [
      new Probe(), new Rect({ aspect: 2, stroke: 'none' }), new Box({ height: px(100) }),
    ] }))
    assert.deepEqual(references, [{ width: 100 }, { width: 100 }])
    assert.deepEqual(grid.children.map(cell => cell.fragment.size),
      [{ width: 20, height: 100 }, { width: 100, height: 100 }, { width: 0, height: 100 }])
  },

  'fixed frames retain overflowing content and do not spread spare height across rows'() {
    const source = new Grid({ columns: [px(100), px(100)], gap: px(10), align: 'start', children: [
      new Box({ width: px(130), height: px(20) }), new Box({ width: px(10), height: px(30) }),
      new Box({ width: px(10), height: px(40) }),
    ] })
    const pass = new LayoutPass()
    const small = pass.layout(source, make_request({ width: exact(80), height: exact(50) }))
    assert.deepEqual(small.size, { width: 80, height: 50 })
    assert.equal(small.overflow.right, 130)
    assert.equal(small.overflow.bottom, 30)
    const tall = pass.layout(source, make_request({ height: exact(200) }))
    assert.equal(tall.children[2].offset.y, 40)
    assert.equal(tall.children[2].fragment.size.height, 40)
  },

  'empty grids, zero allocations, skipped children and explicit holes stay well-defined'() {
    const pass = new LayoutPass()
    assert.deepEqual(pass.layout(new Grid({ columns: 3, gap: px(10) })).size, { width: 0, height: 0 })
    assert.deepEqual(pass.layout(new Grid(), make_request({ width: available(300) })).size, { width: 0, height: 0 })
    assert.deepEqual(pass.layout(new Grid(), make_request({ width: exact(300) })).size, { width: 300, height: 0 })
    const holes = pass.layout(evaluate(`<Grid columns={2} width={px(100)}>
      {false} {null} <Box height={px(10)} /> <Box /> <Box height={px(20)} />
    </Grid>`))
    assert.equal(holes.children.length, 3)
    assert.deepEqual(holes.children[2].offset, { x: 0, y: 10 })
    const zero = pass.layout(new Grid({ columns: [0.5, 0.5], children: new Box({ width: 1, height: px(10) }) }),
      make_request({ width: exact(0) }))
    assert.deepEqual(zero.size, { width: 0, height: 10 })
    const gaps = pass.layout(new Grid({ columns: 3, column_gap: px(10), children: [new Box(), new Box(), new Box()] }),
      make_request({ width: exact(5) }))
    assert.equal(gaps.overflow.right, 15)
  },

  'TextGrid converts strings and numbers once and inherits typography without a wrapper'() {
    const existing = new Text({ children: 'Existing' })
    const source = new TextGrid({ columns: 2, width: px(200), font_size: em(2), children: ['One', 2, existing] })
    assert.equal((source.props.children as unknown[])[2], existing)
    const grid = new LayoutPass().layout(source)
    assert.deepEqual(grid.children.map(cell => cell.fragment.name), ['Text', 'Text', 'Text'])
    near(grid.children[1].offset.x, 109.6)
    near(grid.children[0].fragment.size.height, 38.4)
    near(grid.children[2].offset.y, 57.6)
    assert.equal(new LayoutPass().layout(evaluate('<TextGrid columns={2}>{["A", "B"]}</TextGrid>')).children.length, 2)
  },

  'invalid tracks and circular percentage dependencies report the offending property'() {
    const pass = new LayoutPass()
    for (const columns of [0, -1, 1.5, Infinity, 100001, [], 'auto', [px(-1)], ['1fr'], [null]]) {
      assert.throws(() => pass.layout(new Grid({ columns: columns as GridProps['columns'] })), /Grid.columns/)
    }
    assert.throws(() => pass.layout(new Grid({ column_gap: px(-1) })), /Grid.column_gap/)
    assert.throws(() => pass.layout(new Grid({ row_gap: NaN })), /Grid.row_gap/)
    assert.throws(() => pass.layout(new Grid({ row_gap: '10%' })), /Grid.row_gap/)
    assert.throws(() => pass.layout(new Grid({ columns: [0.5], children: new Box() })), /Grid.columns\[0\]/)
    assert.throws(() => pass.layout(new Grid({ columns: ['auto'], children: new Box({ width: 0.5 }) })), /Grid\/Box\[0\].width/)
    assert.throws(() => pass.layout(new Grid({ width: px(100), height: px(100), children: new Box({ height: 0.5 }) })),
      /Grid\/Box\[0\].height/)
    assert.throws(() => pass.layout(new Grid({ children: new Box({ align_self: 'baseline' }) })), /Grid\/Box\[0\].align_self/)
  },

  'known columns measure ordinary cells once and repeated layouts reuse the cache'() {
    const pass = new LayoutPass()
    const source = new Grid({ columns: 2, width: px(200), children: [new Box({ height: px(10) }), new Box({ height: px(20) })] })
    const grid = pass.layout(source)
    assert.deepEqual(pass.stats, { queries: 3, layouts: 3, hits: 0 })
    assert.equal(pass.layout(source), grid)
    assert.deepEqual(pass.stats, { queries: 4, layouts: 3, hits: 1 })
  },
}

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} grid checks passed.`)

if (false) {
  const tracks: readonly GridTrack[] = [em(2), 'auto', '50%']
  new Grid({ columns: tracks, align: { x: 'fill', y: 'end' } })
  new TextGrid({ columns: 3, children: ['A', 'B'] })
  // @ts-expect-error No CSS fractional tracks.
  new Grid({ columns: ['1fr'] })
  // @ts-expect-error Grid alignment is two-dimensional, without baseline groups.
  new Grid({ align: 'baseline' })
}
