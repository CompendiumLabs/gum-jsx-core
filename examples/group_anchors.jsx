// Each nested Group has its own local 0–1 reference rectangle. The same position
// meets a different point of the Box: its top-left, center, or bottom-right.
<Svg width={px(600)} color={slate}>
  <Box width={1} padding={px(16)}>
    <VStack width={1} gap={px(14)}>
      <Text font_size={px(24)} font_weight={bold}>Choose the point that meets the position</Text>
      <Group aspect={3}>
        {['start', 'center', 'end'].map((anchor, index) =>
          <Group x={index / 3} width={1 / 3}>
            <Line from={{x: 0.5, y: 0.23}} to={{x: 0.5, y: 0.8}} stroke={gray} />
            <Line from={{x: 0.08, y: 0.5}} to={{x: 0.92, y: 0.5}} stroke={gray} />
            <Box x={0.5} y={0.5} anchor={anchor} width={em(5)} height={em(3)}
              background={blue} border_width={px(2)} border_color={blue} radius={px(5)} />
            <Circle x={0.5} y={0.5} anchor="center" width={px(7)} fill={slate} stroke={white} />
            <Text x={0.5} y={0.1} anchor="center" font_weight={bold}>{anchor}</Text>
            <Text x={0.5} y={0.92} anchor="center" font_size={px(12)} color={slate}>x = 0.5, y = 0.5</Text>
          </Group>
        )}
      </Group>
    </VStack>
  </Box>
</Svg>
