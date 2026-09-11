// Rows align their children's first baselines; children without guides use their
// bottom edge. The last row instead stretches every allocation to the text height.
<Svg width={px(540)} font_size={px(16)} color="#203746">
  <Box width={1} padding={px(20)} background="white">
    <VStack width={1} gap={px(22)}>
      <VStack width={1} gap={px(8)}>
        <Text font_size={px(13)} color="#58717e">BASELINES / independent font sizes</Text>
        <HStack gap={px(14)} align="baseline">
          <Text font_size={px(16)}>Small</Text>
          <Text font_size={px(32)} font_weight={700}>Large</Text>
          <Text font_size={px(22)} font_style="italic" color="#317969">Aligned</Text>
          <Square width={px(26)} fill="#bb643d" stroke="none" />
        </HStack>
      </VStack>
      <VStack width={1} gap={px(8)}>
        <Text font_size={px(13)} color="#58717e">PACKING / equal space between fixed items</Text>
        <HStack width={1} justify="space_between" align="center">
          <Circle width={px(28)} fill="#317969" stroke="none" />
          <Text>Space between</Text>
          <Square width={px(28)} fill="#bb643d" stroke="none" />
        </HStack>
      </VStack>
      <VStack width={1} gap={px(8)}>
        <Text font_size={px(13)} color="#58717e">STRETCH / the reflowed text sets the height</Text>
        <HStack width={1} gap={px(14)} align="stretch">
          <Box width={px(8)} background="#317969" radius={px(4)} />
          <Text grow={1} shrink={1} line_height={em(1.4)} text={
            'The green bar stretches to the height of this paragraph after its width is '
            + 'allocated. Resize the SVG and both follow the words onto new lines.'} />
        </HStack>
      </VStack>
    </VStack>
  </Box>
</Svg>
