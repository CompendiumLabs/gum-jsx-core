import assert from 'node:assert/strict';
import {
  Overlay, Attach, Anchor, Rotate, TransformBox, Rect, Circle, Text, TextRow, TextCol,
  TextFrame, Bullets, Slide, Graph, Points, Arc, Arrow, Spline, RoundedLine, HFill,
  Field, LayoutPass, make_request, exact, px, em, render_svg, spline1d, spline2d,
} from '../src/index';
import type { PathDraw } from '../src/index';

function near(a: number, b: number): void { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }
const fixed = make_request({ width: exact(200), height: exact(100) });

const tests: Record<string, () => void> = {
  'overlays hug the base while anchored decorations retain clipped overflow'() {
    const base = new Rect({ width: px(100), height: px(50), fill: 'blue', stroke: 'none' });
    const mark = new Rect({ x: 1, y: 0.5, anchor: 'center', width: px(30), height: px(20), fill: 'red', stroke: 'none' });
    const pass = new LayoutPass(), a = pass.layout(new Overlay({ children: [base, mark] }));
    const b = pass.layout(new Overlay({ children: [base, mark], clip: true }));
    assert.deepEqual(a.size, { width: 100, height: 50 });
    assert.deepEqual(a.children[1].offset, { x: 85, y: 15 });
    assert.equal(a.overflow.right, 15);
    assert.deepEqual(a.overflow, b.overflow);
    assert.equal(b.ink!.width, 100);
    assert.equal(a.children[1].fragment, b.children[1].fragment);
  },

  'rotation includes transformed allocations and explicit matrices retain overflow'() {
    const child = new Rect({ width: px(80), height: px(20), fill: 'blue', stroke: 'none' });
    const pass = new LayoutPass(), rotated = pass.layout(new Rotate({ angle: -90, children: child }));
    near(rotated.size.width, 20); near(rotated.size.height, 80);
    near(rotated.ink!.x, 0); near(rotated.ink!.y, 0);
    assert.deepEqual(rotated.guides, {});
    const transformed = pass.layout(new TransformBox({ matrix: [2, 0, 0, 1, 10, 0], resize: false, children: child }));
    assert.deepEqual(transformed.size, { width: 80, height: 20 });
    assert.equal(transformed.overflow.right, 90);
    assert.deepEqual(transformed.children[0].fragment.size, { width: 80, height: 20 });
    const exact_frame = pass.layout(new Rotate({ angle: 45, children: child }), fixed);
    assert.deepEqual(exact_frame.size, { width: 200, height: 100 });
    assert.throws(() => pass.layout(new Rotate({ angle: NaN, children: child })), /finite/);
  },

  'attachments and zero-size anchors position naturally measured children'() {
    const child = new Rect({ width: px(100), height: px(50), stroke: 'none' });
    const decoration = new Rect({ width: px(20), height: px(10), fill: 'red', stroke: 'none' });
    const pass = new LayoutPass(), attached = pass.layout(new Attach({ children: child,
      attachment: decoration, side: 'left', offset: px(5), at: 1, align: 1 }));
    assert.deepEqual(attached.size, { width: 100, height: 50 });
    assert.deepEqual(attached.children[1].offset, { x: -25, y: 40 });
    const anchor = pass.layout(new Anchor({ children: decoration }));
    assert.deepEqual(anchor.size, { width: 0, height: 0 });
    assert.deepEqual(anchor.children[0].offset, { x: -10, y: -5 });
  },

  'marker callbacks are construction-only and scalar sizes are isotropic'() {
    let shapes = 0, sizes = 0;
    const markers = new Points({ points: [{ x: 0, y: 0 }, null, { x: 1, y: 1 }],
      point_size: (_, i) => { sizes++; return i === 0 ? 0.1 : { x: px(8), y: px(12) }; },
      shape: () => { shapes++; return new Rect({ fill: 'blue', stroke: 'none' }); } });
    assert.equal(shapes, 2); assert.equal(sizes, 2);
    const result = new LayoutPass().layout(markers, fixed);
    assert.deepEqual(result.children.map(child => child.fragment.size), [{ width: 10, height: 10 }, { width: 8, height: 12 }]);
    assert.equal(shapes, 2); assert.equal(sizes, 2);
  },

  'spline helpers own input data, reach endpoints, and preserve degenerate geometry'() {
    const points = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }];
    const curve = spline2d(points), one = spline1d([1, 3, 2]);
    points[0].y = 99;
    assert.deepEqual(curve(0), { x: 0, y: 1 });
    assert.deepEqual(curve(1), { x: 2, y: 2 });
    assert.equal(one(0.5), 3);
    const pass = new LayoutPass();
    const singleton = pass.layout(new Spline({ points: [{ x: 0, y: 0 }] }), fixed);
    assert.equal(singleton.ink, null);
    const repeated = pass.layout(new RoundedLine({ points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }], radius: px(100) }), fixed);
    assert.ok(!/NaN|Infinity/.test(render_svg(repeated)));
    assert.throws(() => spline2d([]), /at least one/);
  },

  'arcs and arrowheads map direction before constructing final pixel geometry'() {
    const pass = new LayoutPass();
    const arc = pass.layout(new Graph({ xlim: [-1, 1], ylim: [-1, 1], children:
      new Arc({ center: { x: 0, y: 0 }, radius: 1, start: 0, end: 90 }) }), fixed);
    const commands = (arc.children[0].fragment.draw[0] as PathDraw).commands;
    assert.deepEqual(commands[0], { kind: 'M', x: 200, y: 50 });
    const end = commands[1];
    assert.equal(end.kind, 'C');
    if (end.kind === 'C') { near(end.x, 100); near(end.y, 0); }
    const arrow = pass.layout(new Graph({ xlim: [0, 1], ylim: [0, 1], children:
      new Arrow({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, head_size: px(10) }) }), fixed);
    const head = arrow.children[0].fragment.draw[1] as PathDraw;
    assert.deepEqual(head.commands[1], { kind: 'L', x: 200, y: 0 });
    const corners = [head.commands[0], head.commands[2]];
    if (corners[0].kind === 'M' && corners[1].kind === 'L') {
      near(Math.hypot(200 - (corners[0].x + corners[1].x) / 2,
        (corners[0].y + corners[1].y) / 2), 10);
    }
    assert.throws(() => pass.layout(new Arc({ end: 721 })), /at most/);
    const zero = pass.layout(new Arrow({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }));
    assert.equal(zero.draw.length, 1);
  },

  'horizontal fills and custom field shapes use correct local coordinates'() {
    const pass = new LayoutPass();
    const fill = pass.layout(new Graph({ xlim: [0, 4], ylim: [0, 2], children:
      new HFill({ points: [{ x: 2, y: 0 }, { x: 3, y: 2 }], boundary: 0 }) }), fixed);
    const commands = (fill.children[0].fragment.draw[0] as PathDraw).commands;
    assert.deepEqual(commands.slice(0, 4), [
      { kind: 'M', x: 100, y: 100 }, { kind: 'L', x: 150, y: 0 },
      { kind: 'L', x: 0, y: 0 }, { kind: 'L', x: 0, y: 100 },
    ]);
    const field = pass.layout(new Graph({ xlim: [0, 1], ylim: [0, 1], children: new Field({
      vectors: [{ point: { x: 0, y: 0 }, vector: { x: 0, y: 1 } }],
      shape: new Rect({ fill: 'blue' }), shape_height: px(4),
    }) }), fixed);
    const glyph = field.children[0].fragment.children[0];
    assert.deepEqual(glyph.fragment.size, { width: 100, height: 4 });
    near(glyph.transform![1], -1);
    assert.deepEqual(glyph.offset, { x: 0, y: 100 });
  },

  'text compositions retain baseline alignment, reflow, and finite slide geometry'() {
    const pass = new LayoutPass();
    const row = pass.layout(new TextRow({ children: [new Text({ text: 'A', font_size: px(12) }),
      new Text({ text: 'B', font_size: px(24) })] }));
    const baselines = row.children.map(child => child.offset.y + child.fragment.guides.baseline!);
    near(baselines[0], baselines[1]);
    const text = new TextFrame({ children: 'This paragraph wraps when its allocated width changes.' });
    const wide = pass.layout(text, make_request({ width: exact(300) }));
    const narrow = pass.layout(text, make_request({ width: exact(150) }));
    assert.ok(narrow.size.height > wide.size.height);
    const bullets = pass.layout(new Bullets({ items: ['one', 'A longer item wraps with a hanging indent.'] }),
      make_request({ width: exact(160) }));
    assert.ok(bullets.size.height > 30);
    const slide = pass.layout(new Slide({ title: 'Title', children: new TextCol({
      children: ['A paragraph', new Circle({ width: em(2), fill: 'blue' })],
    }) }), make_request({ width: exact(640), height: exact(360) }));
    assert.deepEqual(slide.size, { width: 640, height: 360 });
    assert.ok(slide.content!.width < 640);
    assert.ok(!/NaN|Infinity/.test(render_svg(slide)));
  },

  'dash lengths and paint opacity resolve, inherit, serialize, and validate'() {
    const pass = new LayoutPass();
    const graph = pass.layout(new Graph({ font_size: px(20), stroke_dasharray: [px(3), em(0.5)], opacity: 0.4,
      children: new Spline({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }) }), fixed);
    const drawing = graph.children[0].fragment.draw[0];
    assert.deepEqual(drawing.stroke_dasharray, [3, 10]);
    assert.equal(drawing.opacity, 0.4);
    assert.match(render_svg(graph), /stroke-dasharray="3 10"/);
    assert.match(render_svg(graph), /opacity="0.4"/);
    assert.equal(pass.layout(new Rect({ fill: 'blue', opacity: 0 })).ink, null);
    assert.throws(() => pass.layout(new Rect({ opacity: 1.1 })), /opacity/);
    assert.throws(() => pass.layout(new Rect({ stroke_dasharray: [px(-1)] })), /nonnegative/);
  },
};
for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} plotting geometry/composition checks passed.`);
