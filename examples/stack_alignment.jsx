// Rows align their children's first baselines; children without guides use their
// bottom edge. The last row instead stretches every allocation to the text height.
<Svg width={px(540)} font_size={px(16)} color={slate}>
  <Box width={1} padding={px(20)}>
    <VStack width={1} gap={px(22)}>
      <VStack width={1} gap={px(8)}>
        <Text font_size={px(13)} color={slate}>BASELINES / independent font sizes</Text>
        <HStack gap={px(14)} align="baseline">
          <Text font_size={px(16)}>Small</Text>
          <Text font_size={px(32)} font_weight={bold}>Large</Text>
          <Text font_size={px(22)} font_style="italic" color={blue}>Aligned</Text>
          <Square width={px(26)} fill={red} stroke={none} />
        </HStack>
      </VStack>
      <VStack width={1} gap={px(8)}>
        <Text font_size={px(13)} color={slate}>PACKING / equal space between fixed items</Text>
        <HStack width={1} justify="space_between" align="center">
          <Circle width={px(28)} fill={blue} stroke={none} />
          <Text>Space between</Text>
          <Square width={px(28)} fill={red} stroke={none} />
        </HStack>
      </VStack>
      <VStack width={1} gap={px(8)}>
        <Text font_size={px(13)} color={slate}>STRETCH / the reflowed text sets the height</Text>
        <HStack gap={px(14)} align="stretch">
          <Box width={px(8)} background={blue} radius={px(4)} />
          <Text grow={1} shrink={1} line_height={em(1.4)} text={
            'The blue bar stretches to the height of this paragraph after its width is '
            + 'allocated. Resize the SVG and both follow the words onto new lines.'} />
        </HStack>
      </VStack>
    </VStack>
  </Box>
</Svg>
