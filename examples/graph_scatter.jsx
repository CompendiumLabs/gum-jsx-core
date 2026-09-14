// Directed limits reverse x while annotations and custom markers remain upright.
const samples = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 6, y: 3 }, { x: 8, y: 7 }]
return <Svg width={px(540)} height={px(330)}>
  <Box padding={px(28)} background="white">
    <Graph xlim={[10, 0]} ylim={[0, 8]}>
      <Mesh2D xlim={[0, 10]} ylim={[0, 8]} />
      <Spline points={samples} stroke="#7c3aed" stroke_width={px(2)} />
      <Points points={samples} point_size={(p, i) => px(8 + i * 2)}
        shape={<Square fill="#7c3aed" stroke="white" stroke_width={px(1)} />} />
      <Text x={8} y={7} anchor={{ x: 'center', y: 'end' }} font_size={px(14)} color="#5b21b6">Peak</Text>
      <HAxis lim={[10, 0]} /><VAxis lim={[0, 8]} />
    </Graph>
  </Box>
</Svg>
