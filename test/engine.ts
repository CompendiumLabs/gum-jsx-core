import assert from 'node:assert/strict';
import {
  Element, define_element, element_children, Rect, Svg, evaluate,
  LayoutPass, LayoutError, UnresolvedLengthError, resolve_style,
  em, px, natural, available, exact, make_request, finish_size,
  make_size, make_point, make_rect, make_fragment, place_fragment,
  transform_rect, draw_rect, render_svg, inspect_fragment,
} from '../index';
import type { ElementProps } from '../index';
import { Fixed, Expanding, Wrapping } from '../examples/leaves';

const tests: Record<string, () => void> = {
  'construction snapshots nested source data without measuring'() {
    let calls = 0;
    const Probe = define_element<ElementProps & { data?: { values: number[] } }>('Probe', (_, q) => {
      calls++;
      return make_fragment({ size: finish_size(make_size(), q.request, q.sizing) });
    });
    const data = { values: [1, 2] };
    const leaf = new Probe({ data });
    const children = [leaf];
    const root = new Svg({ width: px(100), height: px(50), children });
    data.values.push(3);
    children.length = 0;
    assert.equal(calls, 0);
    assert.deepEqual(leaf.props.data?.values, [1, 2]);
    assert.ok(Object.isFrozen(leaf));
    assert.ok(Object.isFrozen(leaf.props.data?.values));
    assert.ok(!Object.isFrozen(data.values));
    assert.equal(element_children(root.props.children)[0], leaf);
    new LayoutPass().layout(root);
    assert.equal(calls, 1);
  },

  'custom properties belong to the element and introduce no engine layout policy'() {
    const Custom = define_element<ElementProps & { margin: string }>('Custom', (props, query) => {
      // A custom element may use this name for its own data, with no reserved meaning.
      assert.equal(props.margin, 'user data');
      return make_fragment({ size: finish_size(make_size(37, 19), query.request, query.sizing) });
    });
    const fragment = new LayoutPass().layout(new Custom({ margin: 'user data' }));
    assert.equal(fragment.name, 'Custom');
    assert.deepEqual(fragment.size, { width: 37, height: 19 });
    assert.equal(fragment.children.length, 0);
  },

  'element defaults snapshot source data before instances override them'() {
    const defaults = { grow: 1, data: { label: 'original' } };
    const Preset = define_element<ElementProps & { data?: { label: string } }>('Preset', (_, q) =>
      make_fragment({ size: finish_size(make_size(), q.request, q.sizing) }), defaults);
    defaults.grow = 2;
    defaults.data.label = 'changed';
    const a = new Preset(), b = new Preset({ grow: 3 });
    assert.deepEqual(a.props, { grow: 1, data: { label: 'original' } });
    assert.equal(b.props.grow, 3);
    assert.equal(b.props.data?.label, 'original');
    assert.ok(Object.isFrozen(a.props.data));
    assert.ok(!Object.isFrozen(defaults.data));
  },

  'JSX components, spreads, fragments, and scope create ordinary immutable elements'() {
    const code = `
      function tile({ color }) { return <Rect width={0.5} height={em(2)} fill={color}/>; }
      const Tile = tile;
      const sizes = { width: px(160), height: px(80) };
      return <Svg {...sizes}>{false}<><Tile color={color}/></></Svg>;
    `;
    const root = evaluate(code, { scope: { color: '#e66b45' } });
    assert.ok(root instanceof Svg);
    assert.ok(root instanceof Element);
    const child = element_children(root.props.children)[0];
    assert.ok(child instanceof Rect);
    assert.equal(child.props.fill, '#e66b45');
    const fragment = new LayoutPass().layout(root);
    assert.deepEqual(fragment.children[0].fragment.size, { width: 80, height: 32 });
    assert.throws(() => evaluate('return 42'), /one next Element/);
    assert.throws(() => evaluate('<Rect>'), /./);
  },

  'one description lays out at two viewports with independent geometry and fixed strokes'() {
    const leaf = new Rect({ width: 0.5, height: em(2), fill: 'coral', stroke_width: px(2) });
    const source = JSON.stringify(leaf);
    const root = new Svg({ width: px(160), height: px(80), children: leaf });
    const pass = new LayoutPass();
    const first = pass.layout(root);
    const second = pass.layout(root, make_request({ width: exact(320), height: exact(120) }));
    const a = first.children[0].fragment;
    const b = second.children[0].fragment;
    assert.deepEqual(a.size, { width: 80, height: 32 });
    assert.deepEqual(b.size, { width: 160, height: 32 });
    assert.equal(a.draw[0].stroke_width, 2);
    assert.equal(b.draw[0].stroke_width, 2);
    assert.equal(JSON.stringify(leaf), source);
    assert.notEqual(a, b);
    assert.equal(pass.layout(root), first);
    assert.deepEqual(first.ink, { x: 0, y: 0, width: 81, height: 33 });
    assert.equal(first.overflow.left, 1);
  },

  'inherited styles resolve before natural queries and participate in cache identity'() {
    const leaf = new Fixed({ content_width: em(4), content_height: em(1) });
    const pass = new LayoutPass();
    const a = pass.layout(leaf, make_request(), { style: resolve_style({ font_size: px(10) }) });
    const b = pass.layout(leaf, make_request(), { style: resolve_style({ font_size: px(20) }) });
    assert.deepEqual(a.size, { width: 40, height: 10 });
    assert.deepEqual(b.size, { width: 80, height: 20 });
    assert.equal(a.guides.baseline, 8);
    assert.equal(b.guides.baseline, 16);

    const root = new Svg({ width: px(160), height: px(80), font_size: px(12), children: leaf });
    assert.deepEqual(pass.layout(root).children[0].fragment.size, { width: 48, height: 12 });
    const changed = new Rect({ width: em(2), height: em(1), font_size: em(2), stroke_width: em(0.1) });
    const result = pass.layout(changed, make_request(), { style: resolve_style({ font_size: px(10) }) });
    assert.deepEqual(result.size, { width: 40, height: 20 });
    assert.equal(result.draw[0].stroke_width, 2);
    const fractional = new Rect({ width: px(100), height: px(20), stroke_width: 0.1 });
    assert.equal(pass.layout(fractional).draw[0].stroke_width, 2);
  },

  'trial offers and reference boxes are independent cache inputs'() {
    const leaf = new Rect({ width: 0.5, height: px(10), stroke: 'none' });
    const pass = new LayoutPass();
    const request = make_request({ width: available(20) });
    const a = pass.layout(leaf, request, { reference: { width: 200 }, path: 'a' });
    const same = pass.layout(leaf, request, { reference: { width: 200 }, path: 'b' });
    const b = pass.layout(leaf, request, { reference: { width: 100 } });
    const zero = pass.layout(leaf, request, { reference: { width: 0 } });
    assert.equal(a, same);
    assert.equal(a.size.width, 100);
    assert.equal(b.size.width, 50);
    assert.equal(zero.size.width, 0);
    assert.throws(() => pass.layout(leaf, request, { path: 'unknown' }), error => {
      assert.ok(error instanceof UnresolvedLengthError);
      assert.equal(error.path, 'unknown.width');
      return true;
    });
    const allocated = pass.layout(leaf, make_request({ width: exact(20) }), {
      reference: { width: 200 },
    });
    assert.equal(allocated.size.width, 20);
    assert.deepEqual(pass.stats, { queries: 6, layouts: 4, hits: 1 });
  },

  'fixed, expanding, and width-dependent leaves obey different policies through one protocol'() {
    const pass = new LayoutPass();
    const offer = make_request({ width: available(40), height: available(10) });
    assert.deepEqual(pass.layout(new Fixed(), offer).size, { width: 96, height: 20 });
    assert.deepEqual(pass.layout(new Expanding(), offer).size, { width: 40, height: 10 });
    const fixed = pass.layout(new Fixed(), make_request({ width: exact(40), height: exact(10) }));
    assert.deepEqual(fixed.size, { width: 40, height: 10 });
    assert.deepEqual(fixed.overflow, { left: 0, top: 0, right: 56, bottom: 10 });

    const leaf = new Wrapping({ font_size: px(20) });
    const narrow = pass.layout(leaf, make_request({ width: available(39.999999999) }));
    const boundary = pass.layout(leaf, make_request({ width: available(40) }));
    assert.deepEqual(narrow.size, { width: 20, height: 120 });
    assert.deepEqual(boundary.size, { width: 40, height: 60 });
    assert.equal(pass.layout(leaf, make_request({ width: available(40) })), boundary);
    const zero = pass.layout(leaf, make_request({ width: exact(0), height: exact(0) }));
    assert.deepEqual(zero.size, { width: 0, height: 0 });
    assert.deepEqual(zero.overflow, { left: 0, top: 0, right: 20, bottom: 120 });
  },

  'resource revisions invalidate parent caches without changing earlier fragments'() {
    const Measured = define_element('Measured', (_, q) => {
      const metric = q.resource<{ width: number }>('metric');
      return make_fragment({ size: finish_size(make_size(metric.width, 10), q.request, q.sizing) });
    });
    const metric = { width: 12 };
    const pass = new LayoutPass({ metric: { value: metric, version: 1 } });
    const root = new Svg({ width: px(100), height: px(50), children: new Measured() });
    const first = pass.layout(root);
    assert.equal(pass.layout(root), first);
    metric.width = 24;
    pass.set_resource('metric', metric, 2);
    const second = pass.layout(root);
    assert.equal(first.children[0].fragment.size.width, 12);
    assert.equal(second.children[0].fragment.size.width, 24);
    assert.equal(new LayoutPass({ metric: { value: { width: 30 }, version: 2 } })
      .layout(root).children[0].fragment.size.width, 30);
  },

  'parent placement preserves child identity, aggregates transforms, and retains clipped overflow'() {
    const pass = new LayoutPass();
    const leaf = pass.layout(new Rect({ width: px(20), height: px(10), fill: 'blue', stroke: 'none' }));
    const clip = make_fragment({
      size: make_size(10, 10), children: [place_fragment(leaf)], clip: make_rect(0, 0, 10, 10),
    });
    assert.deepEqual(clip.ink, { x: 0, y: 0, width: 10, height: 10 });
    assert.equal(clip.overflow.right, 10);
    const before = pass.stats;
    const placed = place_fragment(clip, make_point(5, 7), [2, 0, 0, 2, 3, 4]);
    const root = make_fragment({ size: make_size(50, 50), children: [placed] });
    assert.equal(root.children[0].fragment, clip);
    assert.deepEqual(root.ink, { x: 8, y: 11, width: 20, height: 20 });
    assert.deepEqual(pass.stats, before);
    assert.deepEqual(transform_rect(leaf.ink, make_point(), [0, 1, -1, 0, 0, 0]), {
      x: -10, y: 0, width: 10, height: 20,
    });
    assert.ok(render_svg(root).includes('translate(5 7) matrix(2 0 0 2 3 4)'));
  },

  'fragment construction owns mutable inputs and rejects nonfinite geometry'() {
    const rect = { x: 0, y: 0, width: 20, height: 10 };
    const draw = { kind: 'rect' as const, rect, fill: 'blue', stroke: 'none', stroke_width: 0 };
    const leaf = make_fragment({ size: make_size(20, 10), draw: [draw] });
    rect.width = 40;
    draw.fill = 'red';
    assert.ok(leaf.draw[0].kind === 'rect');
    assert.equal(leaf.draw[0].rect.width, 20);
    assert.equal(leaf.draw[0].fill, 'blue');
    assert.ok(Object.isFrozen(leaf.draw[0].rect));
    assert.ok(Object.isFrozen(leaf.children));
    const external = { ...leaf, size: { width: 20, height: 10 } };
    const parent = make_fragment({ size: make_size(40, 40), children: [{
      fragment: external, offset: make_point(),
    }] });
    external.size.width = 30;
    assert.equal(parent.children[0].fragment.size.width, 20);
    assert.ok(Object.isFrozen(parent.children[0].fragment));
    assert.throws(() => make_fragment({ size: { width: Infinity, height: 0 } }), RangeError);
    assert.throws(() => make_fragment({ size: make_size(), guides: { baseline: NaN } }), RangeError);
    assert.throws(() => place_fragment(leaf, make_point(), [1, 0, 0, 1, NaN, 0]), RangeError);
  },

  'rendering escapes markup, deduplicates definitions, and neither measures nor assigns speculative IDs'() {
    const pass = new LayoutPass();
    const element = new Rect({ width: px(20), height: px(10), fill: 'red" data-test="<&', stroke: 'none' });
    const leaf = pass.layout(element);
    const clipped = make_fragment({ size: leaf.size, children: [place_fragment(leaf)], clip: make_rect(0, 0, 10, 10) });
    const root = make_fragment({ size: make_size(60, 30), children: [
      place_fragment(clipped, make_point(5, 5)), place_fragment(clipped, make_point(30, 5)),
    ] });
    const before = pass.stats;
    const options = { title: '<hello> & "world"', id_prefix: 'sample' };
    const first = render_svg(root, options);
    assert.ok(first.includes('fill="red&quot; data-test=&quot;&lt;&amp;"'));
    assert.ok(first.includes('<title>&lt;hello&gt; &amp; &quot;world&quot;</title>'));
    assert.equal((first.match(/<clipPath /g) ?? []).length, 1);
    assert.equal((first.match(/url\(#sample-clip-0\)/g) ?? []).length, 2);
    assert.deepEqual(pass.stats, before);
    pass.layout(element, make_request({ width: exact(1) }));
    assert.equal(render_svg(root, options), first);
    assert.ok(!JSON.stringify(root).includes('clip-0'));
    assert.ok(inspect_fragment(root).includes('clipped'));
    assert.throws(() => render_svg(root, { id_prefix: 'bad name' }), /identifier/);
  },

  'failed and recursive queries have element paths and do not poison later layout'() {
    const Broken = define_element('Broken', () => make_fragment({ size: make_size(10, 10) }));
    const pass = new LayoutPass();
    assert.throws(() => pass.layout(new Broken(), make_request({ width: exact(5) })), error => {
      assert.ok(error instanceof LayoutError);
      assert.equal(error.path, 'Broken');
      assert.match(error.message, /sizing policy/);
      return true;
    });
    const NeedsResource = define_element('NeedsResource', (_, q) => {
      q.resource('ready');
      return make_fragment({ size: finish_size(make_size(), q.request, q.sizing) });
    });
    const root = new Svg({ width: px(100), height: px(50), children: new NeedsResource() });
    assert.throws(() => pass.layout(root), /Svg\/NeedsResource\[0\].*Missing layout resource/);
    pass.set_resource('ready', true, 1);
    assert.deepEqual(pass.layout(root).size, { width: 100, height: 50 });

    let loop: Element;
    const Loop = define_element('Loop', (_, q) => q.child(loop, q.request));
    loop = new Loop();
    assert.throws(() => pass.layout(loop), /Recursive layout request/);
    assert.throws(() => pass.layout(loop), /Recursive layout request/);
    assert.deepEqual(pass.layout(new Rect(), make_request({ width: natural() })).size, {
      width: 16, height: 16,
    });
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} engine checks passed.`);
