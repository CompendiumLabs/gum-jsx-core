import {
  define_element, Rect, Svg, px, available, exact, make_request, make_size,
  make_point, finish_size, make_fragment, place_fragment,
} from '../index';
import { Fixed, Expanding, Wrapping } from './leaves';

// Five independent requests show packing, allocation, growth, and a wrap boundary.
const fixed = new Fixed({ fill: '#64af9f' });
const expanding = new Expanding({ fill: '#699fc8' });
const wrapping = new Wrapping({ fill: '#e78a56', font_size: px(16) });
const outline = new Rect({ fill: 'none', stroke: '#314a58', stroke_width: px(1) });

const Protocol = define_element('Protocol', (_props, query) => {
  const size = finish_size(make_size(600, 144), query.request, query.sizing);
  const items = [
    [fixed, make_request({ width: available(60), height: available(40) })],
    [fixed, make_request({ width: exact(60), height: exact(40) })],
    [expanding, make_request({ width: available(60), height: available(40) })],
    [wrapping, make_request({ width: available(31.999999999) })],
    [wrapping, make_request({ width: available(32) })],
  ] as const;
  const children = items.flatMap(([element, request], index) => {
    const child = query.child(element, request, size, index);
    const frame = query.child(outline, make_request({
      width: exact(child.size.width), height: exact(child.size.height),
    }), size, index);
    const offset = make_point(24 + index * 116, 24);
    return [place_fragment(child, offset), place_fragment(frame, offset)];
  });
  return make_fragment({ size, children });
});

const protocol_demo = new Svg({ width: px(600), height: px(144), children: new Protocol() });

export { protocol_demo };
