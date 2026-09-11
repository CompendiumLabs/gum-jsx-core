import assert from 'node:assert/strict';
import {
  HStack, VStack, Spacer, Box, Svg, Rect, Square, Text, Fonts, LayoutPass,
  define_element, evaluate, px, em, make_request, exact, available,
  make_fragment, make_size, finish_size,
} from '../src/index';
import type { FontProvider, StackJustify } from '../src/index';

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

const paragraph = 'A growing paragraph shares its row with a fixed label and a fixed shape. '
  + 'Its words reflow while its font size and the neighboring dimensions stay the same.';

const tests: Record<string, () => void> = {
  'natural rows and columns hug their children with one query per element'() {
    const source = evaluate(`<Svg><HStack gap={px(4)}>
      <Square width={px(32)} stroke="none"/>{false}<><Square width={px(16)} stroke="none"/></>
    </HStack></Svg>`);
    const before = JSON.stringify(source), pass = new LayoutPass();
    const root = pass.layout(source), row = root.children[0].fragment;
    assert.deepEqual(root.size, { width: 52, height: 32 });
    assert.deepEqual(row.children[1].offset, { x: 36, y: 0 });
    assert.deepEqual(pass.stats, { queries: 4, layouts: 4, hits: 0 });
    assert.equal(JSON.stringify(source), before);
    const column = pass.layout(new VStack({ gap: px(4), children: [
      new Square({ width: px(32) }), new Square({ width: px(16) }),
    ] }));
    assert.deepEqual(column.size, { width: 32, height: 52 });
    assert.deepEqual(column.children[1].offset, { x: 0, y: 36 });
    assert.deepEqual(pass.layout(new HStack({ gap: px(20) })).size, make_size());
    assert.deepEqual(pass.layout(new VStack({ gap: px(20), children: new Square() })).size,
      { width: 16, height: 16 });
  },

  'fractional widths and gaps use the full stack even after flex shrinks each slot'() {
    let calls = 0;
    const Probe = define_element('Probe', (_, q) => {
      calls++;
      assert.deepEqual(q.reference, { width: 200, height: 40 });
      assert.equal(q.sizing.width.preferred, 100);
      assert.deepEqual(q.request.width, exact(90));
      return make_fragment({ size: finish_size(make_size(16, 16), q.request, q.sizing) });
    });
    const pass = new LayoutPass();
    const row = pass.layout(new HStack({ width: px(200), height: px(40), gap: 0.1,
      children: [new Probe({ width: 0.5, shrink: 1 }), new Probe({ width: 0.5, shrink: 1 })] }));
    assert.equal(calls, 2);
    assert.equal(row.children[1].offset.x, 110);
    const equal = pass.layout(new HStack({ width: px(200), height: px(40), gap: 0.1,
      children: [new Rect({ basis: 0, grow: 1 }), new Rect({ basis: 0, grow: 1 })] }));
    assert.deepEqual(equal.children.map(child => child.fragment.size), [
      { width: 90, height: 40 }, { width: 90, height: 40 },
    ]);
    const fractions = pass.layout(new HStack({ width: px(200), gap: 0.1,
      children: [new Rect({ basis: 0.5, stroke: 'none' }), new Rect({ basis: 0.5, stroke: 'none' })] }));
    assert.deepEqual(fractions.children.map(child => child.fragment.size.width), [100, 100]);
    assert.equal(fractions.overflow.right, 20);
  },

  'shrink is explicit, weighted by basis, and cannot consume required minima'() {
    const pass = new LayoutPass();
    function row(shrink: number, minima = false) {
      return pass.layout(new HStack({ width: px(220), gap: px(20), children: [
        new Rect({ width: px(100), min_width: px(minima ? 90 : 0), shrink, stroke: 'none' }),
        new Rect({ width: px(200), min_width: px(minima ? 160 : 0), shrink, stroke: 'none' }),
      ] }));
    }
    const shrinking = row(1);
    near(shrinking.children[0].fragment.size.width, 200 / 3);
    near(shrinking.children[1].fragment.size.width, 400 / 3);
    const rigid = row(0);
    assert.deepEqual(rigid.children.map(child => child.fragment.size.width), [100, 200]);
    assert.equal(rigid.overflow.right, 100);
    const limited = row(1, true);
    assert.deepEqual(limited.children.map(child => child.fragment.size.width), [90, 160]);
    assert.equal(limited.overflow.right, 50);
  },

  'stack allocation redistributes clamps, own minima, and impossible gap budgets'() {
    const pass = new LayoutPass();
    const row = pass.layout(new HStack({ width: px(10), children: [
      new Rect({ basis: 0, grow: 1, min_width: px(7), max_width: px(9) }),
      new Rect({ basis: 0, grow: 1, max_width: px(3) }),
    ] }));
    assert.deepEqual(row.children.map(child => child.fragment.size.width), [7, 3]);
    const minimum = pass.layout(new HStack({ min_width: px(100), children: [
      new Rect({ basis: 0, grow: 1 }), new Rect({ basis: 0, grow: 1 }),
    ] }));
    assert.equal(minimum.size.width, 100);
    assert.deepEqual(minimum.children.map(child => child.fragment.size.width), [50, 50]);
    const gaps = pass.layout(new HStack({ width: px(10), gap: px(20), children: [
      new Spacer(), new Spacer(),
    ] }));
    assert.deepEqual(gaps.children.map(child => child.fragment.size.width), [0, 0]);
    assert.equal(gaps.overflow.right, 10);
    const maximum = pass.layout(new VStack({ max_height: px(20), gap: px(5), children: [
      new Square({ height: px(20), stroke: 'none' }), new Square({ height: px(20), stroke: 'none' }),
    ] }));
    assert.equal(maximum.size.height, 20);
    assert.equal(maximum.overflow.bottom, 25);
    const column = pass.layout(new VStack({ width: px(100), height: px(200), gap: px(20), children: [
      new Rect({ basis: 0, grow: 1 }), new Rect({ basis: 0, grow: 2 }),
    ] }));
    assert.deepEqual(column.children.map(child => child.fragment.size), [
      { width: 100, height: 60 }, { width: 100, height: 120 },
    ]);
    assert.deepEqual(column.children[1].offset, { x: 0, y: 80 });
  },

  'flex bases and limits use child fonts while gaps use the stack font'() {
    const row = new LayoutPass().layout(new HStack({ width: px(100), font_size: px(10), gap: em(1),
      children: [
        new Rect({ font_size: em(2), basis: em(2), grow: 1, max_width: em(2.5), stroke_width: em(0.1) }),
        new Rect({ font_size: em(0.5), basis: em(2), grow: 1, stroke_width: em(0.1) }),
      ] }));
    assert.deepEqual(row.children.map(child => child.fragment.size.width), [50, 40]);
    assert.equal(row.children[1].offset.x, 60);
    assert.deepEqual(row.children.map(child => child.fragment.draw[0].stroke_width), [2, 0.5]);
  },

  'mixed rows reflow text at the allocated width and reuse prepared glyphs'() {
    const fonts = new Fonts();
    let shapes = 0;
    const provider: FontProvider = { resolve(family, weight, style) {
      const font = fonts.resolve(family, weight, style);
      return { ...font, shape(text) { shapes++; return font.shape(text); } };
    } };
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } });
    const source = new Svg({ width: px(500), children: new HStack({ width: 1, gap: px(10),
      align: 'center', font_size: px(18), children: [
        new Text({ text: 'Label', width: px(70) }),
        new Text({ text: paragraph, grow: 1, shrink: 1 }),
        new Square({ width: px(40), stroke: 'none' }),
      ] }) });
    const before = JSON.stringify(source), wide = pass.layout(source), count = shapes;
    const narrow = pass.layout(source, make_request({ width: exact(280) }));
    const a = wide.children[0].fragment, b = narrow.children[0].fragment;
    const text = b.children[1].fragment;
    assert.equal(a.children[1].fragment.size.width, 370);
    assert.equal(text.size.width, 150);
    assert.ok(text.children.length > a.children[1].fragment.children.length);
    assert.equal(shapes, count);
    near(text.size.height, text.children.length * 21.6);
    near(narrow.size.height, text.size.height);
    assert.deepEqual(b.children[2].fragment.size, { width: 40, height: 40 });
    assert.equal(b.children[2].offset.x, 240);
    near(b.children[2].offset.y, (text.size.height - 40) / 2);
    assert.equal(JSON.stringify(source), before);
  },

  'columns wrap at their chosen width before adding natural text heights'() {
    const pass = new LayoutPass();
    const text = new Text({ text: paragraph, font_size: px(20) });
    const column = pass.layout(new VStack({ width: px(180), gap: px(8), children: [
      text, new Square({ width: px(24), stroke: 'none' }), text,
    ] }));
    const a = column.children[0].fragment, b = column.children[2].fragment;
    assert.equal(a, b);
    assert.ok(a.children.length > 1);
    near(column.size.height, a.size.height * 2 + 40);
    near(column.children[2].offset.y, a.size.height + 40);
  },

  'natural column stretch remeasures text at the shared width before packing heights'() {
    const pass = new LayoutPass();
    const text = new Text({ text: paragraph, max_width: px(80) });
    const column = pass.layout(new VStack({ align: 'stretch', gap: px(4), children: [
      text, new Box({ width: px(200), height: px(10) }),
    ] }));
    assert.deepEqual(pass.stats, { queries: 4, layouts: 4, hits: 0 });
    const selected = column.children[0].fragment;
    const expected = pass.layout(text, make_request({ width: exact(200) }));
    assert.equal(selected, expected);
    assert.equal(column.size.width, 200);
    near(column.size.height, selected.size.height + 14);
    near(column.children[1].offset.y, selected.size.height + 4);
  },

  'row stretch follows text reflow without scaling glyphs or changing width slots'() {
    const pass = new LayoutPass();
    const text = new Text({ text: paragraph, grow: 1, shrink: 1 });
    const row = pass.layout(new HStack({ width: px(200), align: 'stretch', children: [
      new Rect({ width: px(20), height: px(10), stroke: 'none' }), text,
    ] }));
    const a = row.children[0].fragment, b = row.children[1].fragment;
    assert.equal(a.size.width, 20);
    assert.equal(b.size.width, 180);
    near(a.size.height, b.size.height);
    near(b.size.height, b.children.length * 19.2);
    assert.ok(row.children.every(child => child.transform === undefined));
  },

  'baseline rows align text and bottom-edge fallbacks and propagate through columns'() {
    const pass = new LayoutPass();
    const row = new HStack({ align: 'baseline', gap: px(10), children: [
      new Text({ text: 'Small', font_size: px(16) }),
      new Text({ text: 'Large', font_size: px(32) }), new Square({ width: px(30) }),
    ] });
    const first = pass.layout(row);
    for (const child of first.children) {
      near(child.offset.y + (child.fragment.guides.baseline ?? child.fragment.size.height),
        first.guides.baseline!);
    }
    const above = first.guides.baseline!;
    const below = Math.max(...first.children.map(child => child.fragment.size.height
      - (child.fragment.guides.baseline ?? child.fragment.size.height)));
    near(first.size.height, above + below);
    const column = pass.layout(new VStack({ gap: px(12), children: [row, new Text({ text: 'Last' })] }));
    near(column.guides.baseline!, first.guides.baseline!);
    const last = column.children[1];
    near(column.guides.last_baseline!, last.offset.y + last.fragment.guides.last_baseline!);
    assert.throws(() => pass.layout(new VStack({ align: 'baseline' })), /available on HStack/);
  },

  'main packing and cross alignment move shared fragments including on overflow'() {
    const pass = new LayoutPass();
    const children = [new Rect({ width: px(20), height: px(10), stroke: 'none' }),
      new Rect({ width: px(30), height: px(20), stroke: 'none' })];
    const positions: [StackJustify, number[]][] = [
      ['start', [0, 30]], ['center', [20, 50]], ['end', [40, 70]],
      ['space_between', [0, 70]], ['space_around', [10, 60]], ['space_evenly', [40 / 3, 170 / 3]],
      [0.25, [10, 40]],
    ];
    const request = make_request({ width: exact(100), height: exact(60) });
    const original = pass.layout(new HStack({ gap: px(10), children }), request);
    for (const [justify, positions_x] of positions) {
      const row = pass.layout(new HStack({ gap: px(10), align: 'center', justify, children }), request);
      row.children.forEach((child, index) => {
        assert.equal(child.fragment, original.children[index].fragment);
        near(child.offset.x, positions_x[index]);
        assert.equal(child.offset.y, index ? 20 : 25);
      });
    }
    const overflow = pass.layout(new HStack({ width: px(40), gap: px(10), justify: 'center', children }));
    assert.deepEqual(overflow.children.map(child => child.offset.x), [-10, 20]);
    assert.equal(overflow.overflow.left, 10);
    assert.equal(overflow.overflow.right, 10);
  },

  'Spacer carries ordinary overridable flex metadata in its immutable description'() {
    const pass = new LayoutPass(), spacer = new Spacer();
    assert.deepEqual(spacer.props, { basis: 0, grow: 1 });
    assert.ok(Object.isFrozen(spacer.props));
    assert.deepEqual(pass.layout(spacer).size, make_size());
    const row = pass.layout(new HStack({ width: px(200), gap: px(5), children: [
      new Square({ width: px(20) }), spacer, new Spacer({ grow: 3 }), new Square({ width: px(20) }),
    ] }));
    assert.deepEqual(row.children.map(child => child.fragment.size.width), [20, 36.25, 108.75, 20]);
    assert.equal(row.children[3].offset.x, 180);
    const fixed = pass.layout(new HStack({ width: px(200), children:
      new Spacer({ basis: px(30), grow: 0 }) }));
    assert.equal(fixed.children[0].fragment.size.width, 30);
  },

  'available offers and selected cross sizes do not create percentage references'() {
    const pass = new LayoutPass(), request = make_request({ width: available(100) });
    assert.throws(() => pass.layout(new HStack({ children: new Rect({ width: 0.5 }) }), request,
      { reference: { width: 100 } }), /HStack\/Rect\[0\].width/);
    assert.throws(() => pass.layout(new HStack({ gap: 0.1 }), request), /HStack.gap/);
    const references: unknown[] = [];
    const Probe = define_element('Probe', (_, q) => {
      references.push(q.reference);
      return make_fragment({ size: finish_size(make_size(50, 10), q.request, q.sizing) });
    });
    pass.layout(new VStack({ align: 'stretch', children: [new Probe(), new Box({ width: px(200) })] }));
    assert.deepEqual(references, [{}, {}]);
    const zero = pass.layout(new HStack({ width: px(0), gap: 0.1, children: new Rect({ basis: 0.5 }) }));
    assert.equal(zero.children[0].fragment.size.width, 0);
    for (const props of [{ grow: -1 }, { shrink: Infinity }, { basis: px(-1) }]) {
      assert.throws(() => pass.layout(new HStack({ children: new Rect(props) })), /HStack\/Rect\[0\]/);
    }
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} stack checks passed.`);
