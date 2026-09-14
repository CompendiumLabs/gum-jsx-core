// Bare math functions, periodic samples, and reductions in a complete plot.
const waves = [
  { label: 'sin(x)', fy: sin, color: blue },
  { label: 'cos(x)', fy: cos, color: red },
  { label: 'exp(-x/4) sin(x)', fy: x => exp(-x / 4) * sin(x), color: green },
]
const xs = linspace(0, tau, 16, false)
const ys = xs.map(sin)
const labels = ['0', 'pi/2', 'pi', '3pi/2', '2pi']
return <Svg width={px(720)}>
  <Box padding={px(24)} background={lightgray} color={slate}>
    <VStack gap={px(16)} align="stretch">
      <Text font-size={px(28)} font-weight={bold}>Math, directly in JSX</Text>
      <Plot height={px(320)} xlim={[0, tau]} ylim={[-1.3, 1.3]}
        xlabel="x (radians)" xticks={zip(range(5).map(i => i * pi / 2), labels)}
        legend={waves.map(({ label, color }) => ({ label, color }))}>
        {waves.map(({ fy, color }) => <SymLine fy={fy} xlim={[0, tau]}
          stroke={color} stroke-width={px(2.5)} />)}
        <Points points={zip(xs, ys)}
          point-size={px(6)} fill={blue} stroke={white} stroke-width={px(1)} />
      </Plot>
      <Text font-family={mono} font-size={px(14)}>
        {xs.length} periodic samples. Mean: {rounder(mean(ys), 3)}. RMS: {rounder(norm(ys) / sqrt(ys.length), 3)}.
      </Text>
    </VStack>
  </Box>
</Svg>
