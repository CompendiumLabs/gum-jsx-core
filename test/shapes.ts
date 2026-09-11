import assert from 'node:assert/strict';
import {
  LayoutPass, Rect, RoundedRect, Circle, Ellipse, Line, Polyline, Polygon, Path,
  px, em, make_request, exact, move_to, line_to, quad_to, curve_to, close_path, render_svg,
} from '../index';

const tests: Record<string, () => void> = {
  'all primitives have finite natural geometry and explicit empty or degenerate ink'() {
    const pass = new LayoutPass();
    for (const Shape of [Rect, RoundedRect, Circle, Ellipse, Line, Polyline, Polygon, Path]) {
      const normal = pass.layout(new Shape());
      assert.deepEqual(normal.size, { width: 16, height: 16 });
      const zero = pass.layout(new Shape(), make_request({ width: exact(0), height: exact(0) }));
      assert.deepEqual(zero.size, { width: 0, height: 0 });
      assert.doesNotMatch(render_svg(zero), /NaN|Infinity/);
      assert.equal(zero.ink, null);
    }
    assert.equal(pass.layout(new Path({ commands: [move_to(0, 0)] })).ink, null);
    const dot = pass.layout(new Line({ from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 },
      stroke_linecap: 'round', stroke_width: px(4) }));
    assert.deepEqual(dot.ink, { x: 6, y: 6, width: 4, height: 4 });
  },

  'circle and ellipse radii use their declared scalar or axis references'() {
    const pass = new LayoutPass();
    const request = make_request({ width: exact(100), height: exact(40) });
    const circle = pass.layout(new Circle({ stroke: 'none', fill: 'red' }), request).draw[0];
    const ellipse = pass.layout(new Ellipse(), request).draw[0];
    assert.ok(circle.kind === 'ellipse' && ellipse.kind === 'ellipse');
    assert.deepEqual(circle.center, { x: 50, y: 20 });
    assert.deepEqual(circle.radius, { x: 20, y: 20 });
    assert.deepEqual(ellipse.radius, { x: 50, y: 20 });
    const mixed = pass.layout(new Ellipse({ font_size: px(10), center: { x: px(12), y: em(2) },
      radius: { x: 0.25, y: em(1) } }), request).draw[0];
    assert.ok(mixed.kind === 'ellipse');
    assert.deepEqual(mixed.center, { x: 12, y: 20 });
    assert.deepEqual(mixed.radius, { x: 25, y: 10 });
    const round = pass.layout(new RoundedRect({ radius: px(50) }), request).draw[0];
    assert.ok(round.kind === 'rect');
    assert.deepEqual(round.radius, { x: 50, y: 20 });
    assert.throws(() => pass.layout(new Circle({ radius: px(-1) })), /radius/);
  },

  'resizing changes geometry while explicit pixel strokes remain fixed'() {
    const pass = new LayoutPass();
    const shape = new Line({ from: { x: px(2), y: em(1) }, to: { x: 1, y: 0.5 }, stroke_width: px(3) });
    const small = pass.layout(shape, make_request({ width: exact(40), height: exact(20) }));
    const large = pass.layout(shape, make_request({ width: exact(80), height: exact(40) }));
    assert.equal(small.draw[0].stroke_width, 3); assert.equal(large.draw[0].stroke_width, 3);
    assert.ok(large.draw[0].kind === 'path');
    assert.deepEqual(large.draw[0].commands, [{ kind: 'M', x: 2, y: 16 }, { kind: 'L', x: 80, y: 20 }]);
    const fraction = pass.layout(new Circle({ stroke_width: 0.1 }),
      make_request({ width: exact(80), height: exact(40) }));
    assert.equal(fraction.draw[0].stroke_width, 4);
  },

  'paths resolve every control point, own source data, and bound curves conservatively'() {
    const pass = new LayoutPass();
    const commands = [move_to(0, 0.5), quad_to(px(5), em(-1), 0.5, 0.5),
      curve_to(0.5, 1, 1, 1, 1, 0.5), line_to(0, 0.5), close_path()];
    const element = new Path({ commands, fill: '#234', stroke_linejoin: 'round' });
    commands.length = 0;
    const fragment = pass.layout(element, make_request({ width: exact(100), height: exact(50) }));
    const draw = fragment.draw[0];
    assert.ok(draw.kind === 'path');
    assert.deepEqual(draw.commands[1], { kind: 'Q', x1: 5, y1: -16, x: 50, y: 25 });
    assert.deepEqual(draw.commands[2], { kind: 'C', x1: 50, y1: 50, x2: 100, y2: 50, x: 100, y: 25 });
    assert.deepEqual(draw.bounds, { x: 0, y: -16, width: 100, height: 66 });
    assert.deepEqual(fragment.ink, { x: -0.5, y: -16.5, width: 101, height: 67 });
    assert.ok(Object.isFrozen(draw.commands[1]));
    assert.match(render_svg(fragment), /Q5 -16 50 25C50 50 100 50 100 25/);
    assert.throws(() => pass.layout(new Path({ commands: [line_to(1, 1)] })), /begin with move_to/);
  },

  'polygons close their path and acute miter joins remain within reported ink'() {
    const pass = new LayoutPass();
    const points = [{ x: 0, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }];
    const line = pass.layout(new Polyline({ points }));
    const polygon = pass.layout(new Polygon({ points, stroke_width: px(4), stroke_miterlimit: 8 }));
    assert.ok(line.draw[0].kind === 'path' && polygon.draw[0].kind === 'path');
    assert.equal(line.draw[0].commands.length, 3);
    assert.deepEqual(polygon.draw[0].commands.at(-1), { kind: 'Z' });
    assert.deepEqual(polygon.ink, { x: -16, y: -16, width: 48, height: 48 });
    assert.match(render_svg(polygon), /stroke-miterlimit="8"/);
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} shape checks passed.`);
