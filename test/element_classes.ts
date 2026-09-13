import assert from 'node:assert/strict';
import {
  Element, define_element, define_component, evaluate, LayoutPass,
  make_fragment, shape_size, make_size, make_request, exact, px,
  draw_rect, make_rect, point_bounds, data_bounds, infer_coordinates, render_svg,
} from '../src/index';
import type { ElementProps, LayoutQuery, PointValue } from '../src/index';

const tests: Record<string, () => void> = {
  'subclasses inherit construction and snapshot source without measuring'() {
    let calls = 0;
    type Props = ElementProps & { data?: { values: readonly number[] } };
    class Tile extends Element<Props> {
      static defaults = { width: px(80), height: px(40), fill: 'blue' };
      static layout(props: Props, query: LayoutQuery) {
        calls++;
        assert(Object.isFrozen(props));
        const size = shape_size(query.request, query.sizing);
        return make_fragment({ size, draw: [draw_rect(make_rect(0, 0, size.width, size.height), {
          fill: query.style.fill, stroke: 'none', stroke_width: 0,
        })] });
      }
    }
    const data = { values: [1, 2] };
    const tile = new Tile({ data, fill: 'tomato' });
    data.values.push(3);
    assert.equal(calls, 0);
    assert(tile instanceof Tile && tile instanceof Element);
    assert(Object.isFrozen(tile) && Object.isFrozen(tile.props.data?.values));
    assert(!Object.isFrozen(data.values));
    assert.deepEqual(tile.props.data?.values, [1, 2]);
    const pass = new LayoutPass();
    const first = pass.layout(tile);
    assert.equal(first.name, 'Tile');
    assert.deepEqual(first.size, { width: 80, height: 40 });
    assert.equal(first.draw[0].fill, 'tomato');
    assert.equal(pass.layout(tile), first);
    assert.deepEqual(pass.layout(tile, make_request({ width: exact(160) })).size, { width: 160, height: 40 });
    assert.equal(calls, 2);
  },

  'normalization consumes raw input once before merging source defaults'() {
    type Source = ElementProps & { values?: readonly number[] };
    type Input = ElementProps & { sample?: (index: number) => number };
    let normalizations = 0, samples = 0;
    class Sampled extends Element<Source, Input> {
      static defaults = { width: px(40), height: px(20), values: [99] };
      static normalize({ sample, ...props }: Input): Source {
        normalizations++;
        assert.equal(props.width, undefined);
        return sample ? { ...props, values: [0, 1].map(sample) } : props;
      }
      static layout(props: Source, query: LayoutQuery) {
        assert(!('sample' in props));
        return make_fragment({ size: shape_size(query.request, query.sizing) });
      }
    }
    const sampled = new Sampled({ sample: i => { samples++; return i * 2; } });
    const pass = new LayoutPass();
    pass.layout(sampled);
    pass.layout(sampled, make_request({ width: exact(80) }));
    assert.deepEqual(sampled.props.values, [0, 2]);
    assert.equal(normalizations, 1);
    assert.equal(samples, 2);
    assert.deepEqual(new Sampled().props.values, [99]);
    assert(Object.isFrozen(sampled.props.values));
    // Constructor input and stored data remain separately typed.
    if (false) {
      // @ts-expect-error values belongs to the normalized source, not the input
      new Sampled({ values: [1] });
      // @ts-expect-error callbacks do not survive in source props
      sampled.props.sample;
    }
  },

  'subclasses merge inherited defaults and bind inherited hooks to their own class'() {
    type Props = ElementProps & { tag?: string };
    class Preset extends Element<Props> {
      static defaults: Partial<Props> = { width: px(30), height: px(12), fill: 'blue' };
    }
    class Tile extends Preset {
      static defaults: Partial<Props> = { fill: 'green' };
      static normalize(props: Props) { return { ...props, tag: this.name }; }
      static layout(props: Props, query: LayoutQuery) {
        assert.equal(props.tag, this.name);
        return make_fragment({ size: shape_size(query.request, query.sizing) });
      }
    }
    class Small extends Tile {
      static defaults: Partial<Props> = { width: px(10) };
    }
    const tile = new Tile(), small = new Small({ height: px(8) });
    const pass = new LayoutPass();
    assert.deepEqual(pass.layout(tile).size, { width: 30, height: 12 });
    assert.deepEqual(pass.layout(small).size, { width: 10, height: 8 });
    assert.equal(tile.props.fill, 'green');
    assert.equal(small.props.fill, 'green');
    assert.equal(small.type.name, 'Small');
    assert.equal(new Small({ fill: undefined }).props.fill, undefined);
  },

  'class defaults and hooks stay stable after their first construction'() {
    type Props = ElementProps & { data?: { label: string } };
    const defaults = { data: { label: 'original' } };
    class Stable extends Element<Props> {
      static defaults = defaults;
      static layout(_props: Props, query: LayoutQuery) {
        return make_fragment({ size: shape_size(query.request, query.sizing), label: 'original' });
      }
    }
    const first = new Stable();
    defaults.data.label = 'changed';
    Stable.layout = (_props, query) => make_fragment({
      size: shape_size(query.request, query.sizing), label: 'changed',
    });
    const second = new Stable();
    assert.equal(first.props.data?.label, 'original');
    assert.equal(second.props.data?.label, 'original');
    assert(!Object.isFrozen(defaults.data));
    assert.equal(new LayoutPass().layout(second).label, 'original');
  },

  'bounds and layout survive component adoption without renormalization'() {
    type Source = ElementProps & { points?: readonly PointValue[] };
    type Input = ElementProps & { make_points?: () => readonly PointValue[] };
    let calls = 0;
    class Mark extends Element<Source, Input> {
      static normalize({ make_points, ...props }: Input): Source {
        calls++;
        return { ...props, points: make_points?.() ?? [[2, 3], [6, 9]] };
      }
      static data_bounds(props: Source) { return point_bounds(props.points ?? []); }
      static layout(_props: Source, query: LayoutQuery) {
        return make_fragment({ size: shape_size(query.request, query.sizing) });
      }
    }
    class OtherMark extends Mark {}
    const Wrapped = define_component<Input>('Wrapped', props => new OtherMark(props));
    const wrapped = new Wrapped();
    assert.equal(calls, 1);
    assert.equal(wrapped.type.name, 'Wrapped');
    assert(!(wrapped instanceof Mark));
    assert.deepEqual(data_bounds(wrapped), { xlim: [2, 6], ylim: [3, 9] });
    assert.deepEqual(infer_coordinates([wrapped]).xlim, [2, 6]);
    const pass = new LayoutPass();
    pass.layout(wrapped);
    pass.layout(wrapped, make_request({ width: exact(50) }));
    assert.equal(calls, 1);
  },

  'JSX can define and subclass Element directly with static fields and hooks'() {
    const tile = evaluate(`
      class Tile extends Element {
        static defaults = { width: px(20), height: px(10), fill: blue };
        static normalize({ labelText = 'hello', ...props }) {
          return { ...props, label_text: labelText };
        }
        static layout(props, query) {
          return make_fragment({ size: shape_size(query.request, query.sizing), label: props.label_text });
        }
      }
      class Wide extends Tile { static defaults = { width: px(60) }; }
      return <Wide labelText="from JSX" font-size={px(12)} />;
    `);
    const result = new LayoutPass().layout(tile);
    assert.equal(result.name, 'Wide');
    assert.equal(result.label, 'from JSX');
    assert.deepEqual(result.size, { width: 60, height: 10 });
    assert.deepEqual(tile.props.font_size, px(12));
    assert(Object.isFrozen(tile));
  },

  'explicit names, factory subclasses, and low-level descriptors remain usable'() {
    const Factory = define_element('Factory', (_props, query) =>
      make_fragment({ size: shape_size(query.request, query.sizing) }), { width: px(24), height: px(12) });
    class Derived extends Factory {}
    class Named extends Derived { static element_name = 'StableName'; }
    assert.equal(new Factory().type.name, 'Factory');
    assert.equal(new Derived().type.name, 'Derived');
    assert.equal(new Named().type.name, 'StableName');
    const instance = new Named(), adopted = new Element(instance.type, instance.props);
    const pass = new LayoutPass();
    assert.equal(render_svg(pass.layout(adopted)), render_svg(pass.layout(instance)));
    assert(Object.isFrozen(adopted) && Object.isFrozen(adopted.type));
  },

  'class definitions report missing hooks and preserve source restrictions'() {
    class Missing extends Element {}
    class Invalid extends Element { static layout = 3; }
    class BadName extends Element { static element_name = ''; }
    class Data extends Element {
      static layout() { return make_fragment({ size: make_size() }); }
    }
    class Mutable extends Data { counter = 0; }
    assert.throws(() => new Missing(), /Missing must define static layout/);
    assert.throws(() => new Invalid(), /Invalid.layout must be a function/);
    assert.throws(() => new BadName(), /nonempty string/);
    assert.throws(() => new Mutable(), TypeError);
    assert.throws(() => new Data({ children: (() => 1) as never }), /source data cannot contain functions/);
    assert.throws(() => new Element(), /must define static layout/);
  },
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`${Object.keys(tests).length} element class checks passed.`);
