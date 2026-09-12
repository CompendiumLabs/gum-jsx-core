// Width flows inward; measured paragraph height flows back out to the Svg.
// Try --width 220: the words reflow, with the same padding, border, and glyphs.
<Svg width={px(360)} font_size={px(18)} color={slate}>
  <Box width={1} padding={em(1)} border_width={px(2)} border_color={blue}
    background={white} radius={px(12)}>
    <Text line_height={em(1.4)}>
      <Span font_weight={bold}>A card that hugs its paragraph.</Span>
      {'\n\nThe width goes in; the height comes back out. '}
      <Span font_style="italic" color={blue}>The words find new lines,</Span>
      {' while the 18px font, 1em padding, and 2px border keep their sizes. '}
      {'Neither Box nor Svg needs a height.'}
    </Text>
  </Box>
</Svg>
