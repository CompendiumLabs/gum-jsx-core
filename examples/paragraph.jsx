// A fixed stage 3 gallery arrangement. Both columns query
// the same Text description; only the offered width changes.
class Paragraphs extends Element {
  static layout(props, query) {
    const size = finish_size(make_size(768, 440), query.request, query.sizing)
    const [title, subtitle, wide_label, narrow_label, paragraph] = element_children(props.children)
    const wide = query.child(paragraph, make_request({ width: exact(408) }), size, 4)
    const narrow = query.child(paragraph, make_request({ width: exact(224) }), size, 4)
    const labels = [[title, 24, 22], [subtitle, 24, 66],
      [wide_label, 24, 108], [narrow_label, 496, 108]]
    const children = labels.map(([element, x, y], index) =>
      place_fragment(query.child(element, make_request(), size, index), make_point(x, y)))
    const frames = [[wide, 24], [narrow, 496]].map(([fragment, x]) =>
      draw_rect(make_rect(x, 138, fragment.size.width, fragment.size.height),
        { fill: 'white', stroke: gray, stroke_width: 1 }))
    children.push(place_fragment(wide, make_point(24, 138)),
      place_fragment(narrow, make_point(496, 138)))
    return make_fragment({ size, draw: frames, children })
  }
}

return <Svg width={px(768)} height={px(440)} color={slate}>
  <Paragraphs>
    <Text font_size={px(28)} font_weight={bold}>One paragraph, two widths</Text>
    <Text font_size={px(14)} color={slate}>Same source and prepared glyphs. Both columns use an 18px font.</Text>
    <Text font_size={px(13)} font_weight={bold} color={blue}>408px allocation</Text>
    <Text font_size={px(13)} font_weight={bold} color={blue}>224px allocation</Text>
    <Text font_size={px(18)} line_height={em(1.45)}>
      {'A paragraph now answers a width offer with '}
      <Span font_weight={bold}>real glyph measurements.</Span>
      {' The words reflow, while the font size stays at 18 pixels. '}
      <Span font_style="italic" color={blue}>Styled runs share the same baseline,</Span>
      {' and the prepared text is reused for each allocation.'}
    </Text>
  </Paragraphs>
</Svg>
