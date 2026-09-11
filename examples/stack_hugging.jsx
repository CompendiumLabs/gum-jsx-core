// All parent dimensions come from content: two naturally packed stacks inside a Box.
<Svg font_size={px(16)} color="#203746">
  <Box padding={em(1)} border_width={px(2)} border_color="#317969"
    background="white" radius={px(12)}>
    <VStack gap={em(0.75)}>
      <HStack gap={em(0.75)} align="center">
        <Circle height={em(2)} fill="#317969" stroke="none" />
        <Text font_size={em(1.25)} font_weight={700}>Stacks, all the way down.</Text>
      </HStack>
      <Text font_size={px(14)} color="#58717e">The row hugs. The column hugs. The SVG hugs.</Text>
    </VStack>
  </Box>
</Svg>
