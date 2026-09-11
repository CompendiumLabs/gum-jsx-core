import assert from 'node:assert/strict';
import {
  Box, Frame, Fit, Svg, Square, Rect, Text, Fonts, LayoutPass, evaluate,
  px, em, make_request, exact, available, make_size, make_insets,
  render_svg, inspect_fragment,
} from '../index';
import type { FontProvider } from '../index';
import { Fixed } from '../examples/leaves';

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

const tests: Record<string, () => void> = {
  'Svg and Box hug a Square with one query per element'() {
    const source = evaluate(`<Svg><Box padding={em(1)} border_width={px(2)}>
      <Square width={px(64)} fill="teal" stroke="none"/>
    </Box></Svg>`);
    const before = JSON.stringify(source);
    const pass = new LayoutPass();
    const root = pass.layout(source);
    const box = root.children[0].fragment, square = box.children[0];
    assert.deepEqual(root.size, { width: 100, height: 100 });
    assert.deepEqual(box.size, root.size);
    assert.deepEqual(box.content, { x: 18, y: 18, width: 64, height: 64 });
    assert.deepEqual(square.offset, { x: 18, y: 18 });
    assert.deepEqual(square.fragment.size, { width: 64, height: 64 });
    assert.deepEqual(root.ink, { x: 0, y: 0, width: 100, height: 100 });
    assert.deepEqual(root.overflow, make_insets());
    assert.deepEqual(pass.stats, { queries: 3, layouts: 3, hits: 0 });
    assert.equal(pass.layout(source), root);
    assert.equal(JSON.stringify(source), before);
    assert.match(render_svg(root), /width="100" height="100" viewBox="0 0 100 100"/);
    assert.match(inspect_fragment(root), /content=18,18,64,64/);
    assert.deepEqual(pass.layout(new Svg({ children: new Box({ children: new Square() }) })).size,
      { width: 16, height: 16 });
  },

  'nested boxes add insets and propagate baselines through outer padding'() {
    const pass = new LayoutPass();
    const leaf = new Fixed({ content_width: px(40), content_height: px(20), fill: 'teal' });
    const inner = new Box({
      padding: { left: px(3), top: px(4), right: px(5), bottom: px(6) },
      border_width: px(2), children: leaf,
    });
    const box = new Box({
      padding: { left: px(7), top: px(8), right: px(9), bottom: px(10) }, children: inner,
    });
    const root = pass.layout(new Svg({ children: box }));
    const wrapper = root.children[0].fragment, frame = wrapper.children[0];
    assert.deepEqual(root.size, { width: 68, height: 52 });
    assert.equal(wrapper.name, 'Box');
    assert.deepEqual(frame.offset, { x: 7, y: 8 });
    assert.deepEqual(frame.fragment.size, { width: 52, height: 34 });
    assert.deepEqual(frame.fragment.content, { x: 5, y: 6, width: 40, height: 20 });
    assert.equal(frame.fragment.guides.baseline, 22);
    assert.equal(root.guides.baseline, 30);
    const outer = pass.layout(new Box({ padding: px(4), children: box }));
    assert.deepEqual(outer.size, { width: 76, height: 60 });
    assert.equal(outer.guides.baseline, 34);
  },

  'outer padding leaves inner sizing intact and stretch forwards exact allocations'() {
    const pass = new LayoutPass();
    const inner = new Box({ width: px(80), height: px(40), padding: px(4) });
    const box = new Box({ padding: px(8), align: 'stretch', children: inner });
    const natural = pass.layout(box);
    assert.deepEqual(natural.size, { width: 96, height: 56 });
    assert.deepEqual(natural.children[0].fragment.size, { width: 80, height: 40 });
    const allocated = pass.layout(box, make_request({ width: exact(60), height: exact(30) }));
    assert.deepEqual(allocated.size, { width: 60, height: 30 });
    assert.deepEqual(allocated.children[0].fragment.size, { width: 44, height: 14 });
    const tiny = pass.layout(box, make_request({ width: exact(10), height: exact(0) }));
    assert.deepEqual(tiny.size, { width: 10, height: 0 });
    assert.deepEqual(tiny.children[0].fragment.size, make_size());
    assert.ok(tiny.overflow.right > 0 && tiny.overflow.bottom > 0);
    assert.doesNotMatch(render_svg(tiny), /NaN|Infinity/);

    // Ordinary alignment keeps the child offer advisory, even in a tight wrapper.
    const loose = pass.layout(new Box({ padding: px(8), children: inner }),
      make_request({ width: exact(60), height: exact(30) }));
    assert.deepEqual(loose.children[0].fragment.size, { width: 80, height: 40 });
    assert.ok(loose.overflow.right > 0 && loose.overflow.bottom > 0);
  },

  'each box resolves em padding with its own font before measuring children'() {
    const pass = new LayoutPass();
    const source = new Svg({ font_size: px(10), children: new Box({
      font_size: em(2), padding: em(0.5), border_width: em(0.1),
      children: new Box({ font_size: em(0.5), padding: em(0.5),
        children: new Square({ width: em(2) }),
      }),
    }) });
    const root = pass.layout(source), box = root.children[0].fragment;
    const wrapper = box.children[0].fragment;
    assert.deepEqual(wrapper.size, { width: 30, height: 30 });
    assert.deepEqual(wrapper.children[0].offset, { x: 5, y: 5 });
    assert.deepEqual(wrapper.children[0].fragment.size, { width: 20, height: 20 });
    assert.deepEqual(box.content, { x: 12, y: 12, width: 30, height: 30 });
    assert.deepEqual(root.size, { width: 54, height: 54 });
  },

  'nested boxes establish their own percentage references after padding'() {
    const pass = new LayoutPass();
    const source = new Svg({ width: px(200), height: px(100), children: new Box({
      width: 1, height: 1, padding: px(10), children: new Box({
        width: 1, height: 1, padding: 0.1,
        children: new Rect({ width: 0.5, height: px(20), stroke: 'none' }),
      }),
    }) });
    const box = pass.layout(source).children[0].fragment;
    const wrapper = box.children[0].fragment;
    assert.deepEqual(box.content, { x: 10, y: 10, width: 180, height: 80 });
    assert.deepEqual(wrapper.size, { width: 180, height: 80 });
    assert.deepEqual(wrapper.content, { x: 18, y: 8, width: 144, height: 64 });
    assert.deepEqual(wrapper.children[0].fragment.size, { width: 72, height: 20 });
    assert.deepEqual(wrapper.children[0].offset, { x: 18, y: 8 });
    const partial = pass.layout(new Box({ width: px(200), padding: px(10),
      children: new Rect({ width: 0.5, height: px(20), stroke: 'none' }) }));
    assert.deepEqual(partial.size, { width: 200, height: 40 });
    assert.equal(partial.children[0].fragment.size.width, 90);
    const fixed = pass.layout(new Box({ min_width: px(100), max_width: px(100),
      children: new Rect({ width: 0.5, height: px(20) }) }));
    assert.equal(fixed.children[0].fragment.size.width, 50);
  },

  'hugging axes reject percentage cycles instead of using temporary offers'() {
    const pass = new LayoutPass();
    const hugging = new Box({ children: new Rect({ width: 0.5 }) });
    assert.throws(() => pass.layout(hugging, make_request({ width: available(200) }),
      { reference: { width: 200 } }), /Box\/Rect\[0\]\.width.*definite fraction reference/);
    assert.throws(() => pass.layout(new Svg({ children: new Box({ padding: 0.1 }) })),
      /Box\[0\]\.padding.left.*definite fraction reference/);
    assert.throws(() => pass.layout(new Box({ width: px(100), children: new Rect({ height: 0.5 }) })),
      /Rect\[0\]\.height.*definite fraction reference/);
    const zero = pass.layout(new Box({ width: px(0), height: px(0),
      children: new Rect({ width: 0.5, height: 0.5 }) }));
    assert.deepEqual(zero.children[0].fragment.size, make_size());
  },

  'framed text reflows without changing font measurements or source descriptions'() {
    const fonts = new Fonts();
    let shapes = 0;
    const provider: FontProvider = { resolve(family, weight, style) {
      const font = fonts.resolve(family, weight, style);
      return { ...font, shape(text) { shapes++; return font.shape(text); } };
    } };
    const pass = new LayoutPass({ fonts: { value: provider, version: 0 } });
    const text = new Text({ text: 'A framed paragraph reflows at its offered width and keeps its font size.',
      font_size: px(20), line_height: em(1.4) });
    const source = JSON.stringify(text);
    const box = new Box({ padding: px(12), border_width: px(2), children: text });
    const wide = pass.layout(box, make_request({ width: exact(360) }));
    const before = shapes;
    const narrow = pass.layout(box, make_request({ width: exact(180) }));
    const a = wide.children[0].fragment, b = narrow.children[0].fragment;
    assert.ok(b.children.length > a.children.length);
    assert.equal(shapes, before);
    near(b.size.height, b.children.length * 28);
    near(narrow.size.height, b.size.height + 28);
    assert.equal(narrow.content!.width, 152);
    near(narrow.guides.baseline!, 14 + b.guides.baseline!);
    assert.equal(JSON.stringify(text), source);
    assert.deepEqual(pass.stats, { queries: 4, layouts: 4, hits: 0 });
    const root = pass.layout(new Svg({ width: px(180), children: box }));
    near(root.size.height, narrow.size.height);
    assert.equal(root.size.width, 180);
  },

  'alignment moves completed children and stretch uses exact established axes'() {
    const pass = new LayoutPass();
    const leaf = new Fixed({ content_width: px(40), content_height: px(20), fill: 'teal' });
    const frame = { width: px(100), height: px(80), padding: px(10), children: leaf };
    const center = pass.layout(new Box({ ...frame, align: 'center' }));
    assert.deepEqual(center.children[0].offset, { x: 30, y: 30 });
    assert.equal(center.guides.baseline, 46);
    const end = pass.layout(new Box({ ...frame, align: { x: 'end', y: 'start' } }));
    assert.equal(center.children[0].fragment, end.children[0].fragment);
    assert.deepEqual(end.children[0].offset, { x: 50, y: 10 });
    const stretch = pass.layout(new Box({ ...frame, align: 'stretch' }));
    assert.deepEqual(stretch.children[0].fragment.size, { width: 80, height: 60 });
    assert.deepEqual(stretch.children[0].offset, { x: 10, y: 10 });
    const natural = pass.layout(new Box({ padding: px(10), align: 'stretch', children: leaf }));
    assert.deepEqual(natural.size, { width: 60, height: 40 });
  },

  'empty and undersized boxes retain inset overflow without negative content dimensions'() {
    const pass = new LayoutPass();
    assert.deepEqual(pass.layout(new Box()).size, make_size());
    const empty = pass.layout(new Box({ padding: px(8), border_width: px(2) }));
    assert.deepEqual(empty.size, { width: 20, height: 20 });
    assert.deepEqual(empty.content, { x: 10, y: 10, width: 0, height: 0 });
    const tiny = pass.layout(new Box({ padding: px(8), width: px(10), height: px(8) }));
    assert.deepEqual(tiny.content, { x: 8, y: 8, width: 0, height: 0 });
    assert.deepEqual(tiny.overflow, { left: 0, top: 0, right: 6, bottom: 8 });
    const border = pass.layout(new Box({ border_width: px(20), width: px(10), height: px(8) }));
    assert.deepEqual(border.ink, { x: 0, y: 0, width: 10, height: 8 });
    assert.doesNotMatch(render_svg(border), /NaN|Infinity/);
    assert.throws(() => pass.layout(new Box({ children: [new Rect(), new Rect()] })), /one content/);
    assert.throws(() => pass.layout(new Box({ padding: px(-1) })), /padding/);
  },

  'rounded clipping preserves overflow and borders stay inside the allocated frame'() {
    const pass = new LayoutPass();
    const props = { width: px(30), height: px(16), padding: px(2), border_width: px(2),
      radius: px(8), children: new Fixed({ fill: 'coral' }) };
    const visible = pass.layout(new Box(props));
    const clipped = pass.layout(new Box({ ...props, clip: true }));
    assert.ok(visible.ink!.width > 30);
    assert.deepEqual(clipped.ink, { x: 0, y: 0, width: 30, height: 16 });
    assert.deepEqual(clipped.overflow, visible.overflow);
    assert.deepEqual(clipped.children[0].fragment.clip,
      { x: 2, y: 2, width: 26, height: 12, radius: { x: 6, y: 6 } });
    const border = clipped.children.at(-1)!.fragment;
    assert.equal(border.name, 'Border');
    assert.deepEqual(border.overflow, make_insets());
    assert.match(render_svg(clipped), /rx="6" ry="6"/);
    const frame = pass.layout(new Frame({ children: new Square({ width: px(20), stroke: 'none' }) }));
    assert.deepEqual(frame.size, { width: 22, height: 22 });
    assert.deepEqual(frame.ink, { x: 0, y: 0, width: 22, height: 22 });
  },

  'Fit scales completed geometry and guides uniformly, with explicit cover clipping'() {
    const pass = new LayoutPass();
    const leaf = new Fixed({ content_width: px(200), content_height: px(100), fill: 'teal' });
    const props = { width: px(100), height: px(100), children: leaf };
    const contain = pass.layout(new Fit(props));
    assert.deepEqual(contain.children[0].offset, { x: 0, y: 25 });
    assert.deepEqual(contain.children[0].transform, [0.5, 0, 0, 0.5, 0, 0]);
    assert.equal(contain.guides.baseline, 65);
    const cover = pass.layout(new Fit({ ...props, mode: 'cover', clip: true }));
    assert.equal(cover.children[0].fragment, contain.children[0].fragment);
    assert.deepEqual(cover.children[0].offset, { x: -50, y: 0 });
    assert.deepEqual(cover.ink, { x: 0, y: 0, width: 100, height: 100 });
    assert.equal(cover.overflow.left, 50); assert.equal(cover.overflow.right, 50);
    const width = pass.layout(new Fit({ width: px(100), children: leaf }));
    assert.deepEqual(width.size, { width: 100, height: 50 });
    const down = pass.layout(new Fit({ width: px(400), height: px(200), mode: 'scale_down', children: leaf }));
    assert.deepEqual(down.children[0].transform, [1, 0, 0, 1, 0, 0]);
    const zero = pass.layout(new Fit({ width: px(0), height: px(0), children: leaf }));
    assert.deepEqual(zero.children[0].transform, [0, 0, 0, 0, 0, 0]);
    assert.equal(zero.ink, null);
    assert.deepEqual(pass.layout(new Fit()).size, make_size());
  },

  'fitting text is distinct from ordinary Box reflow and keeps pixel strokes in the source'() {
    const pass = new LayoutPass();
    const text = new Text({ text: 'Several words make a long label', font_size: px(20) });
    const box = pass.layout(new Box({ width: px(100), children: text }));
    const fit = pass.layout(new Fit({ width: px(100), children: text }));
    assert.ok(box.children[0].fragment.children.length > 1);
    assert.equal(fit.children[0].fragment.children.length, 1);
    assert.ok(fit.children[0].transform![0] < 1);
    const square = pass.layout(new Square(), make_request({ width: exact(80), height: exact(40) }));
    assert.ok(square.draw[0].kind === 'rect');
    assert.deepEqual(square.draw[0].rect, { x: 20, y: 0, width: 40, height: 40 });
    const scaled = pass.layout(new Fit({ width: px(40), children: new Square({
      width: px(20), stroke_width: px(2),
    }) }));
    assert.equal(scaled.children[0].fragment.draw[0].stroke_width, 2);
    assert.equal(scaled.children[0].transform![0], 2);
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} box checks passed.`);
