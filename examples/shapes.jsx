// This gallery grid is a fixed test arrangement, not a layout container API.
const ShapeGallery = define_element('ShapeGallery', (props, query) => {
  const size = finish_size(make_size(720, 396), query.request, query.sizing);
  const items = element_children(props.children);
  const children = [place_fragment(query.child(items[0], make_request(), size), make_point(24, 20))];
  items.slice(1).forEach((item, index) => {
    const cell = floor(index / 2), label = index % 2;
    const x = 32 + cell % 4 * 176, y = 92 + floor(cell / 4) * 156;
    const request = label ? make_request() : make_request({ width: exact(128), height: exact(80) });
    children.push(place_fragment(query.child(item, request, size, index + 1),
      make_point(x, y + (label ? 98 : 0))));
  });
  return make_fragment({ size, children });
});

return <Svg width={px(720)} height={px(396)} color={slate} font_size={px(14)}
  stroke={slate} stroke_width={px(3)} fill={blue} stroke_linejoin="round">
  <ShapeGallery>
    <Text font_size={px(28)} font_weight={bold}>Ordinary shapes, ordinary pixels</Text>
    <Rect /><Text>Rect</Text>
    <RoundedRect radius={px(16)} /><Text>RoundedRect · 16px</Text>
    <Circle /><Text>Circle · inscribed</Text>
    <Ellipse /><Text>Ellipse · per axis</Text>
    <Line from={{x: 0, y: 0.8}} to={{x: 1, y: 0.2}} stroke_linecap="round" />
    <Text>Line · round caps</Text>
    <Polyline points={[{x: 0, y: 0.8}, {x: 0.3, y: 0.2}, {x: 0.6, y: 0.6}, {x: 1, y: 0.1}]}
      fill={none} /><Text>Polyline</Text>
    <Polygon points={[{x: 0, y: 0.7}, {x: 0.3, y: 0}, {x: 0.85, y: 0.15}, {x: 1, y: 1}]} />
    <Text>Polygon</Text>
    <Path commands={[move_to(0, 0.7), curve_to(0.25, -0.2, 0.65, 1.2, 1, 0.25),
      quad_to(0.6, 1, 0, 0.7), close_path()]} />
    <Text>Path · cubic + quadratic</Text>
  </ShapeGallery>
</Svg>;
