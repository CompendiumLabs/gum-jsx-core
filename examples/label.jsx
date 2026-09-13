// Explicit placement makes the stage 3 completion example small and inspectable.
// The circle has a 2em diameter; the label has a separate 20px font size.
class Labeled extends Element {
  static layout(props, query) {
    const size = finish_size(make_size(380, 96), query.request, query.sizing);
    const [icon, label] = element_children(props.children);
    const circle = query.child(icon, make_request(), size, 0);
    const text = query.child(label, make_request({ width: available(270) }), size, 1);
    return make_fragment({ size, children: [
      place_fragment(circle, make_point(24, (size.height - circle.size.height) / 2)),
      place_fragment(text, make_point(80, (size.height - text.size.height) / 2)),
    ] });
  }
}

return <Svg width={px(380)} height={px(96)} font_size={px(16)}>
  <Labeled>
    <Circle width={em(2)} height={em(2)} fill={blue} stroke={slate} stroke_width={px(2)} />
    <Text font_size={px(20)} color={slate}>
      <Span font_weight={bold}>Ready to compose</Span>{'\nShapes and text, independently sized.'}
    </Text>
  </Labeled>
</Svg>;
