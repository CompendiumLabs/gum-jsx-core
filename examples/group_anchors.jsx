// Each nested Group has its own local 0–1 reference rectangle. The same position
// meets a different point of the Box: its top-left, center, or bottom-right.
<Svg width={px(600)} color="#203746">
  <Box width={1} padding={px(16)} background="white">
    <VStack width={1} gap={px(14)}>
      <Text font_size={px(24)} font_weight={700}>Choose the point that meets the position</Text>
      <Group width={1} aspect={3}>
        {['start', 'center', 'end'].map((anchor, index) =>
          <Group x={index / 3} width={1 / 3} height={1}>
            <Line from={{x: 0.5, y: 0.23}} to={{x: 0.5, y: 0.8}} stroke="#c9dcd3" />
            <Line from={{x: 0.08, y: 0.5}} to={{x: 0.92, y: 0.5}} stroke="#c9dcd3" />
            <Box x={0.5} y={0.5} anchor={anchor} width={em(5)} height={em(3)}
              background="#d5ebe1" border_width={px(2)} border_color="#317969" radius={px(5)} />
            <Circle x={0.5} y={0.5} anchor="center" width={px(7)} fill="#203746" stroke="white" />
            <Text x={0.5} y={0.1} anchor="center" font_weight={700}>{anchor}</Text>
            <Text x={0.5} y={0.92} anchor="center" font_size={px(12)} color="#58717e">x = 0.5, y = 0.5</Text>
          </Group>
        )}
      </Group>
    </VStack>
  </Box>
</Svg>
