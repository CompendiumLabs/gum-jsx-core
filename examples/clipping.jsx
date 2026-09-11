// Clip and transform operate on measured results and keep overflow inspectable.
const Clipping = define_element('Clipping', (props, query) => {
  const size = finish_size(make_size(320, 144), query.request, query.sizing);
  const [tile] = element_children(props.children);
  const leaf = query.child(tile, make_request({ width: exact(80), height: exact(60) }), size);
  const clipped = make_fragment({
    name: 'Clip', size: make_size(40, 40), clip: make_rect(0, 0, 40, 40),
    children: [place_fragment(leaf)],
  });

  return make_fragment({ size, children: [
    place_fragment(leaf, make_point(16, 32)),
    place_fragment(clipped, make_point(128, 32)),
    place_fragment(clipped, make_point(224, 32), [1.5, 0.4, -0.4, 1.5, 0, 0]),
  ] });
});

return <Svg width={px(320)} height={px(144)}>
  <Clipping><Rect fill="#e78a56" stroke="none" /></Clipping>
</Svg>;
