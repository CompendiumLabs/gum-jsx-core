// Group fixes the canvas before laying out its children. Positions and the text
// region use fractions; node diameters, fonts, and strokes keep their pixel sizes.
// Try --width 400 to reflow the same drawing at a smaller canvas size.
<Svg width={px(640)} color={slate}>
  <Box width={1} padding={px(16)}>
    <VStack width={1} gap={px(14)}>
      <Text font_size={px(24)} font_weight={bold}>A place for everything</Text>
      <Group aspect={2}>
        <Box width={1} height={1} background={lightgray} border_width={px(1)}
          border_color={gray} radius={px(10)} />
        <Line from={{x: 0.16, y: 0.5}} to={{x: 0.4, y: 0.28}} stroke={gray} stroke_width={px(2)} />
        <Line from={{x: 0.16, y: 0.5}} to={{x: 0.4, y: 0.72}} stroke={gray} stroke_width={px(2)} />
        <Circle x={0.16} y={0.5} anchor="center" width={px(52)} fill={blue} stroke={none} />
        <Circle x={0.4} y={0.28} anchor="center" width={px(40)} fill={red} stroke={none} />
        <Circle x={0.4} y={0.72} anchor="center" width={px(40)} fill={green} stroke={none} />
        <Text x={0.16} y={0.5} anchor="center" font_weight={bold} color={white}>A</Text>
        <Text x={0.4} y={0.28} anchor="center" font_weight={bold} color={white}>B</Text>
        <Text x={0.4} y={0.72} anchor="center" font_weight={bold} color={white}>C</Text>
        <VStack x={0.57} y={0.5} anchor={{y: 'center'}} width={0.39} gap={px(8)}>
          <Text font_size={px(20)} font_weight={bold}>One canvas</Text>
          <Text font_size={px(14)} line_height={em(1.4)} text={
            'Positions follow the canvas. These circles keep their pixel size, '
            + 'while this paragraph reflows within a fractional width.'} />
        </VStack>
      </Group>
      <Text font_size={px(13)} color={slate}>Fractional positions / pixel-sized nodes / a reflowing text region</Text>
    </VStack>
  </Box>
</Svg>
