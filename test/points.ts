import assert from 'node:assert/strict';
import {
  LayoutPass, Graph, Rect, RoundedRect, Square, Circle, Ellipse, Dot, Line, UnitLine, HLine, VLine,
  Polyline, Polygon, Triangle, CoordLine, Spline, RoundedLine, Segments, Arc, Fill, HFill, VFill,
  Arrow, ArrowHead, Ray, Points, Field, exact, make_request, px, em, evaluate, render_svg,
  data_bounds, infer_coordinates, point_bounds, map_point, unmap_point,
  spline_path, rounded_path, arc_path, spline2d, sample_points, add2, lingrid, zip,
  draw_rect, draw_ellipse, make_rect, make_clip, make_fragment, place_fragment, transform_rect,
} from '../src/index';
import type { Element, PointValue, PositionValue, PathDraw, VectorSample } from '../src/index';

const fixed = make_request({ width: exact(200), height: exact(100) });
const resized = make_request({ width: exact(300), height: exact(200) });

function equivalent(a: Element, b: Element) {
  const pass = new LayoutPass();
  for (const request of [fixed, resized]) assert.deepEqual(pass.layout(a, request), pass.layout(b, request));
}

const tests: Record<string, () => void> = {
  'primitives mix tuple and record positions with fractions, px, and em'() {
    const from = [px(12), em(2)] as const, to = [0.75, 0.5] as const;
    for (const Shape of [Line, UnitLine, HLine, VLine]) {
      equivalent(new Shape({ from, to: { x: to[0], y: to[1] } }),
        new Shape({ from: { x: from[0], y: from[1] }, to }));
    }
    for (const Shape of [Polyline, Polygon, Triangle]) {
      equivalent(new Shape({ points: [from, { x: 0.4, y: 0.2 }, to] }),
        new Shape({ points: [{ x: from[0], y: from[1] }, { x: 0.4, y: 0.2 }, { x: to[0], y: to[1] }] }));
    }
    for (const Shape of [Circle, Dot]) {
      equivalent(new Shape({ center: from, radius: px(8) }),
        new Shape({ center: { x: from[0], y: from[1] }, radius: px(8) }));
    }
    const radius = [0.25, em(1)] as const;
    equivalent(new Ellipse({ center: from, radius }),
      new Ellipse({ center: { x: from[0], y: from[1] }, radius: { x: radius[0], y: radius[1] } }));
    for (const Shape of [Rect, RoundedRect, Square]) {
      equivalent(new Shape({ radius }), new Shape({ radius: { x: radius[0], y: radius[1] } }));
    }
    const path = new LayoutPass().layout(new Line({ font_size: px(10), from, to }), fixed).draw[0] as PathDraw;
    assert.deepEqual(path.commands, [{ kind: 'M', x: 12, y: 20 }, { kind: 'L', x: 150, y: 50 }]);
  },

  'plot marks infer and render identical geometry from tuples and records'() {
    const tuples: readonly PointValue[] = [[-2, 1], { x: 0, y: 4 }, [3, 2]];
    const records = [{ x: -2, y: 1 }, { x: 0, y: 4 }, { x: 3, y: 2 }];
    const pairs: [Element, Element][] = [];
    for (const Mark of [CoordLine, Spline, RoundedLine, Fill, HFill, VFill, Arrow, Points]) {
      pairs.push([new Mark({ points: tuples }), new Mark({ points: records })]);
    }
    pairs.push(
      [new Segments({ segments: [[[0, 1], [2, 3]], [{ x: -1, y: -2 }, [4, 5]]] }),
        new Segments({ segments: [[{ x: 0, y: 1 }, { x: 2, y: 3 }], [{ x: -1, y: -2 }, { x: 4, y: 5 }]] })],
      [new Arc({ center: [1, 2], radius: [3, 1], start: 20, end: 300 }),
        new Arc({ center: { x: 1, y: 2 }, radius: { x: 3, y: 1 }, start: 20, end: 300 })],
      [new Arc({ center: [1, 2], radius: px(10) }), new Arc({ center: { x: 1, y: 2 }, radius: px(10) })],
      [new Arrow({ from: [-2, 1], to: { x: 3, y: 2 }, start_head: true }),
        new Arrow({ from: records[0], to: records[2], start_head: true })],
      [new ArrowHead({ tip: [3, 2], angle: 45 }), new ArrowHead({ tip: records[2], angle: 45 })],
      [new Ray({ origin: [-2, 1], angle: 45 }), new Ray({ origin: records[0], angle: 45 })],
      [new Points({ points: tuples, point_size: [0.05, em(1)] }),
        new Points({ points: records, point_size: { x: 0.05, y: em(1) } })],
    );
    for (const [a, b] of pairs) {
      assert.deepEqual(data_bounds(a), data_bounds(b), a.type.name);
      equivalent(a, b);
      equivalent(new Graph({ children: a }), new Graph({ children: b }));
      // Directed limits and flips apply after reading either point representation.
      const coord = { xlim: [4, -4] as const, ylim: [-3, 6] as const, flip_x: true, flip_y: false };
      equivalent(new Graph({ ...coord, children: a }), new Graph({ ...coord, children: b }));
    }
    assert.deepEqual(infer_coordinates(new CoordLine({ points: tuples })),
      { xlim: [-2, 3], ylim: [1, 4], flip_x: false, flip_y: true });
    assert.deepEqual(data_bounds(new Arc({ center: [1, 2], radius: [3, 1] })),
      { xlim: [-2, 4], ylim: [1, 3] });
  },

  'mixed tuple paths and fill boundaries preserve gaps and exclude nonfinite bounds'() {
    const points: readonly (PointValue | null)[] = [
      [-2, 2], { x: -1, y: 3 }, [0, NaN], [1, 4], { x: 2, y: 2 }, null, [9, Infinity],
    ];
    const expected = { xlim: [-2, 2], ylim: [2, 4] };
    assert.deepEqual(point_bounds(points), expected);
    const pass = new LayoutPass();
    for (const Mark of [CoordLine, Spline, RoundedLine]) {
      const mark = new Mark({ points });
      assert.deepEqual(data_bounds(mark), expected);
      const fragment = pass.layout(new Graph({ children: mark }), fixed);
      const path = fragment.children[0].fragment.draw[0] as PathDraw;
      assert.equal(path.commands.filter(c => c.kind === 'M').length, 2);
      assert.doesNotMatch(render_svg(fragment), /NaN|Infinity/);
    }
    const upper: readonly PointValue[] = [[-2, 2], [-1, 3], [0, 4], [1, 3], [2, 2]];
    const boundary: readonly (PointValue | null)[] = [{ x: -2, y: -1 }, [-1, -1], [0, Infinity], [1, 0], [2, 0]];
    for (const Mark of [Fill, VFill, HFill]) {
      const fill = new Mark({ points: upper, boundary });
      assert.deepEqual(data_bounds(fill), { xlim: [-2, 2], ylim: [-1, 3] });
      const path = pass.layout(fill, fixed).draw[0] as PathDraw;
      assert.equal(path.commands.filter(c => c.kind === 'M').length, 2);
      assert.equal(path.commands.filter(c => c.kind === 'Z').length, 2);
    }
    assert.deepEqual(data_bounds(new CoordLine({ points: [[px(-100), 50], [1, 2], [3, 4]] })),
      { xlim: [1, 3], ylim: [2, 4] });
    assert.equal(data_bounds(new CoordLine({ points: [[1, 2]], space: 'local' })), null);
  },

  'marker callbacks receive owned records and original indices for tuple inputs'() {
    const source: [number, number] = [0.25, 0.5];
    const calls: [string, number, PositionValue][] = [];
    const marker = new Points({ points: [source, null, [1, NaN], { x: 0.75, y: 0.5 }],
      point_size: (point, index) => {
        calls.push(['size', index, point]);
        assert.ok(Object.isFrozen(point));
        return [point.x, px(8)];
      },
      shape: (point, index) => {
        calls.push(['shape', index, point]);
        return new Rect({ fill: index ? 'blue' : 'red' });
      },
    });
    assert.deepEqual(calls, [
      ['size', 0, { x: 0.25, y: 0.5 }], ['shape', 0, { x: 0.25, y: 0.5 }],
      ['size', 3, { x: 0.75, y: 0.5 }], ['shape', 3, { x: 0.75, y: 0.5 }],
    ]);
    source[0] = 99;
    const pass = new LayoutPass(), fragment = pass.layout(marker, fixed);
    assert.deepEqual(fragment.children.map(p => p.fragment.size), [{ width: 50, height: 8 }, { width: 150, height: 8 }]);
    assert.deepEqual(fragment.children[0].offset, { x: 25, y: 46 });
    pass.layout(marker, resized);
    assert.equal(calls.length, 4);
    assert.equal(Object.isFrozen(source), false);
  },

  'field callbacks normalize both vector representations once before resize'() {
    const source: [number, number] = [0, 0], vector: [number, number] = [0, 1];
    const calls: [number, VectorSample][] = [];
    const field = new Field({ vectors: [
      { point: [0, 0], vector: [0, 0] }, { point: source, vector },
      { point: { x: 1, y: 0 }, vector: [1, 0] }, { point: [1, NaN], vector: [1, 2] },
    ], shape: (sample, index) => {
      calls.push([index, sample]);
      assert.equal(sample.point.y, 0);
      assert.equal(sample.vector.x + sample.vector.y, 1);
      return new Rect({ fill: 'blue' });
    }, shape_height: px(4) });
    assert.deepEqual(calls, [
      [1, { point: { x: 0, y: 0 }, vector: { x: 0, y: 1 } }],
      [2, { point: { x: 1, y: 0 }, vector: { x: 1, y: 0 } }],
    ]);
    source[0] = 100; vector[1] = 100;
    assert.deepEqual(data_bounds(field), { xlim: [0, 2], ylim: [0, 1] });
    const pass = new LayoutPass(), graph = new Graph({ children: field });
    const fragment = pass.layout(graph, fixed).children[0].fragment;
    assert.deepEqual(fragment.children[0].offset, { x: 0, y: 100 });
    assert.deepEqual(fragment.children[0].fragment.size, { width: 100, height: 4 });
    pass.layout(graph, resized);
    assert.equal(calls.length, 2);
  },

  'public geometry helpers accept tuples and retain record outputs'() {
    const tuples = [[0, 1], [1, 3], [2, 2]] as const;
    const records = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }];
    assert.deepEqual(spline_path(tuples), spline_path(records));
    assert.deepEqual(rounded_path(tuples, 0.2), rounded_path(records, 0.2));
    assert.deepEqual(arc_path([1, 2], [3, 4], 10, 130), arc_path({ x: 1, y: 2 }, { x: 3, y: 4 }, 10, 130));
    const coord = infer_coordinates(new CoordLine({ points: tuples })), size = { width: 200, height: 100 };
    assert.deepEqual(map_point([1, 2], coord, size), { x: 100, y: 50 });
    assert.deepEqual(unmap_point([100, 50], coord, size), { x: 1, y: 2 });
    const paint = { fill: 'blue', stroke: 'none', stroke_width: 0 }, rect = make_rect(0, 0, 20, 10);
    const ellipse = draw_ellipse([10, 5], [4, 3], paint);
    assert.deepEqual(ellipse.center, { x: 10, y: 5 });
    assert.deepEqual(ellipse.radius, { x: 4, y: 3 });
    assert.deepEqual(draw_rect(rect, paint, [4, 3]).radius, { x: 4, y: 3 });
    assert.deepEqual(make_clip(rect, [100, 3]).radius, { x: 10, y: 3 });
    const fragment = make_fragment({ size, draw: [ellipse] });
    assert.deepEqual(place_fragment(fragment, [3, -2]).offset, { x: 3, y: -2 });
    assert.deepEqual(transform_rect(rect, [3, -2]), { x: 3, y: -2, width: 20, height: 10 });
    assert.ok(Object.isFrozen(ellipse.center));
  },

  'tuple inputs are snapshotted by elements and spline samplers'() {
    const points: [number, number][] = [[0, 1], [1, 3], [2, 2]];
    const line = new CoordLine({ points }), spline = spline2d(points);
    points[0][1] = 99; points[1][1] = 99; points.length = 0;
    assert.deepEqual(data_bounds(line), { xlim: [0, 2], ylim: [1, 3] });
    assert.deepEqual(spline(0), { x: 0, y: 1 });
    assert.deepEqual(spline(0.5), { x: 1, y: 3 });
    assert.deepEqual(spline(1), { x: 2, y: 2 });
    assert.ok(Object.isFrozen(line.props.points![0]));
    assert.deepEqual(sample_points({ f: spline, samples: 3 }), [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }]);
  },

  'malformed points fail clearly instead of silently corrupting bounds or geometry'() {
    const pass = new LayoutPass();
    for (const bad of [[], [1], [1, 2, 3], Array(2), {}, { x: 1 }]) {
      const value = bad as unknown as PointValue;
      const error = /exactly two coordinates/;
      assert.throws(() => pass.layout(new Line({ from: value })), error);
      assert.throws(() => pass.layout(new Ellipse({ radius: value })), error);
      assert.throws(() => data_bounds(new CoordLine({ points: [value] })), error);
      assert.throws(() => pass.layout(new Points({ points: [[0, 0]], point_size: value })), error);
      assert.throws(() => new Field({ vectors: [{ point: [0, 0], vector: value }] }), error);
      assert.throws(() => spline2d([value]), error);
      assert.throws(() => add2(value, 1), error);
      assert.throws(() => lingrid([0, 1], [0, 1], value), error);
      assert.throws(() => sample_points({ f: () => value, samples: 1 }),
        (e: unknown) => e instanceof Error && /Sample 0/.test(e.message)
          && e.cause instanceof TypeError && error.test(e.cause.message));
    }
    assert.throws(() => pass.layout(new Circle({ center: [1, NaN] })), /finite/);
    assert.throws(() => pass.layout(new Ellipse({ radius: [px(-1), px(1)] })), /nonnegative/);
  },

  'JSX and host code can pass zip results straight to point-taking elements'() {
    const code = `const xs = linspace(0, 2, 3); return <Graph>
      <CoordLine points={zip(xs, xs.map(x => x * x))} />
      <Points points={[[0, 0], {x: 1, y: 1}, [2, 4]]} point-size={[px(6), px(8)]} />
    </Graph>`;
    const points = zip([0, 1, 2], [0, 1, 4]);
    equivalent(evaluate(code), new Graph({ children: [
      new CoordLine({ points }), new Points({ points, point_size: [px(6), px(8)] }),
    ] }));
  },
};

for (const [name, test] of Object.entries(tests)) { test(); console.log(`ok - ${name}`); }
console.log(`${Object.keys(tests).length} point input checks passed.`);
