// Inspect line boxes and baseline guides using plain drawing/placement records.
class Specimen extends Element {
  static layout(props, query) {
    const size = finish_size(make_size(680, 560), query.request, query.sizing);
    const children = [], draw = [];
    let y = 20;
    element_children(props.children).forEach((element, index) => {
      const fragment = query.child(element, make_request({ width: exact(632) }), size, index);
      children.push(place_fragment(fragment, make_point(24, y)));
      if (index > 0 && index % 2 === 0) {
        draw.push(draw_rect(make_rect(24, y, 632, fragment.size.height),
          { fill: lightgray, stroke: none, stroke_width: 0 }));
        for (const line of fragment.children) {
          const baseline = y + line.offset.y + line.fragment.guides.baseline;
          draw.push(draw_rect(make_rect(24, baseline, 632, 0.5),
            { fill: blue, stroke: none, stroke_width: 0 }));
        }
      }
      y += fragment.size.height + (index % 2 === 0 ? 24 : 8);
    });
    return make_fragment({ size, draw, children });
  }
}

return <Svg width={px(680)} height={px(560)} color={slate}>
  <Specimen>
    <Text font_size={px(28)} font_weight={bold}>Type, ink, and line boxes</Text>
    <Text font_size={px(13)} color={slate}>Light, regular, bold, and synthesized italic</Text>
    <Text font_size={px(24)}>
      <Span font_weight={light}>Light </Span>{' Regular '}
      <Span font_weight={bold}>Bold </Span><Span font_style="italic">Italic</Span>
    </Text>
    <Text font_size={px(13)} color={slate}>Mixed sizes share one measured baseline</Text>
    <Text font_size={px(18)}>
      {'Small '}
      <Span font_size={em(2)} font_weight={bold} color={blue}>Big</Span>
      {' and small again.'}
    </Text>
    <Text font_size={px(13)} color={slate}>28px glyphs in a 12px line box: ink is allowed to overflow</Text>
    <Text font_size={px(28)} line_height={px(12)}>Jolly glyphs: Agjpy</Text>
    <Text font_size={px(13)} color={slate}>Preserved whitespace, tab stops, and explicit newlines</Text>
    <Text font_family={mono} font_size={px(16)} whitespace="pre" wrap={false}>
      {'name\tvalue\nsize\t16px\nline\t1.2em'}
    </Text>
    <Text font_size={px(13)} color={slate}>Center-aligned lines in an exact allocation</Text>
    <Text font_size={px(20)} text_align="center">{'A centered first line\nwith a shorter second'}</Text>
  </Specimen>
</Svg>;
