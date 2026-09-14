// Fit measures once at the natural size, then scales the completed text.
// This is explicit scaling, distinct from the reflow in card.jsx.
<Svg color={slate}>
  <Frame padding={px(16)} border_width={px(2)} border_color={blue}
    radius={px(12)}>
    <Fit width={px(280)} height={px(80)}>
      <Text font_size={px(16)} font_weight={bold}>One fitted line</Text>
    </Fit>
  </Frame>
</Svg>
