// Inspect line boxes and baseline guides using plain drawing/placement records.
const Specimen = define_element('Specimen', (props, query) => {
  const size = finish_size(make_size(680, 560), query.request, query.sizing);
  const children = [], draw = [];
  let y = 20;
  element_children(props.children).forEach((element, index) => {
    const fragment = query.child(element, make_request({ width: exact(632) }), size, index);
    children.push(place_fragment(fragment, make_point(24, y)));
    if (index > 0 && index % 2 === 0) {
      draw.push(draw_rect(make_rect(24, y, 632, fragment.size.height),
        { fill: '#e7eef2', stroke: 'none', stroke_width: 0 }));
      for (const line of fragment.children) {
        const baseline = y + line.offset.y + line.fragment.guides.baseline;
        draw.push(draw_rect(make_rect(24, baseline, 632, 0.5),
          { fill: '#65b5a0', stroke: 'none', stroke_width: 0 }));
      }
    }
    y += fragment.size.height + (index % 2 === 0 ? 24 : 8);
  });
  return make_fragment({ size, draw, children });
});

return <Svg width={px(680)} height={px(560)} color="#203746">
  <Specimen>
    <Text font_size={px(28)} font_weight={700}>Type, ink, and line boxes</Text>
    <Text font_size={px(13)} color="#536b7b">Light, regular, bold, and synthesized italic</Text>
    <Text font_size={px(24)}>
      <Span font_weight={300}>Light </Span>{' Regular '}
      <Span font_weight={700}>Bold </Span><Span font_style="italic">Italic</Span>
    </Text>
    <Text font_size={px(13)} color="#536b7b">Mixed sizes share one measured baseline</Text>
    <Text font_size={px(18)}>
      {'Small '}
      <Span font_size={em(2)} font_weight={700} color="#237768">Big</Span>
      {' and small again.'}
    </Text>
    <Text font_size={px(13)} color="#536b7b">28px glyphs in a 12px line box: ink is allowed to overflow</Text>
    <Text font_size={px(28)} line_height={px(12)}>Jolly glyphs: Agjpy</Text>
    <Text font_size={px(13)} color="#536b7b">Preserved whitespace, tab stops, and explicit newlines</Text>
    <Text font_family="IBM Plex Mono" font_size={px(16)} whitespace="pre" wrap={false}>
      {'name\tvalue\nsize\t16px\nline\t1.2em'}
    </Text>
    <Text font_size={px(13)} color="#536b7b">Center-aligned lines in an exact allocation</Text>
    <Text font_size={px(20)} text_align="center">{'A centered first line\nwith a shorter second'}</Text>
  </Specimen>
</Svg>;
