// The row reserves 76px + 40px + two 0.75em gaps. The paragraph gets the rest.
// Try --width 360: both rows grow taller, and every parent hugs their new height.
function Entry({ label, text, color }) {
  return <HStack gap={em(0.75)} align="center">
    <Text width={px(76)} font_size={px(14)} font_weight={bold} color={color}>{label}</Text>
    <Text grow={1} shrink={1} line_height={em(1.4)}>{text}</Text>
    <Square width={px(40)} fill={color} stroke={none} />
  </HStack>;
}

return <Svg width={px(620)} font_size={px(18)} color={slate}>
  <Box width={1} padding={px(20)} border_width={px(2)} border_color={blue}
    background={white} radius={px(14)}>
    <VStack width={1} gap={px(20)}>
      <VStack width={1} gap={px(6)}>
        <Text font_size={px(28)} font_weight={bold}>Room to stack</Text>
        <Text font_size={px(14)} color={slate}>One width. As much height as the words need.</Text>
      </VStack>
      <Entry label="LAYOUT" color={blue}
        text={'A fixed label and a fixed Square leave the paragraph room to grow. '
          + 'Give this SVG less width and its words find new lines.'} />
      <Box width={1} height={px(1)} background={gray} />
      <Entry label="DETAILS" color={red}
        text={'Both rows sit in a column. The column, its frame, and the SVG all hug the resulting height. '
          + 'Font sizes and border widths stay put.'} />
      <HStack width={1} gap={px(10)} align="baseline" color={slate} font_size={px(11)}>
        <Text font_weight={bold}>FIXED + FLEXIBLE</Text>
        <Spacer />
        <Text>18px type / 2px border</Text>
      </HStack>
    </VStack>
  </Box>
</Svg>
