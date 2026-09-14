// Thick shafts stay behind arrow tips for every cap style and route shape.
const caps = ['butt', 'round', 'square']
const CapColumn = ({ cap }) => <VStack gap={px(12)}>
  <Text width={px(224)} text-align="center" font-family={mono}>{cap}</Text>
  <Group width={px(224)} height={px(140)}>
    {[24, 200].map(x => <Line from={[px(x), px(12)]} to={[px(x), px(128)]}
      stroke={gray} stroke-width={px(1)} stroke-dasharray={[px(3), px(4)]} />)}
    <Arrow from={[px(24), px(40)]} to={[px(200), px(40)]}
      stroke={slate} stroke-width={px(8)} stroke-linecap={cap}
      head-size={px(28)} head-width={0.8} head-style={{fill: blue}} />
    <Arrow from={[px(24), px(100)]} to={[px(200), px(100)]} start-head
      stroke={slate} stroke-width={px(8)} stroke-linecap={cap}
      head-size={px(28)} head-width={0.8} head-style={{fill: green}} />
  </Group>
</VStack>
return <Svg width={px(760)}>
  <Box padding={px(24)} background={white} color={slate}>
    <VStack gap={px(20)} align="stretch">
      <Text font-size={px(28)} font-weight={bold}>Arrow tips, clean at every cap</Text>
      <Text font-size={px(14)}>The dashed guides mark the requested endpoints.</Text>
      <HStack gap={px(20)}>{caps.map(cap => <CapColumn cap={cap} />)}</HStack>
      <HStack gap={px(20)}>
        <VStack gap={px(12)}>
          <Text width={px(346)} text-align="center" font-family={mono}>curved / square caps</Text>
          <Group width={px(346)} height={px(180)}>
            <Arrow points={[[0.08, 0.75], [0.4, 0.2], [0.66, 0.8], [0.92, 0.25]]}
              curve start-head stroke={slate} stroke-width={px(8)} stroke-linecap="square"
              head-size={px(28)} head-width={0.8} head-style={{fill: blue}} />
          </Group>
        </VStack>
        <VStack gap={px(12)}>
          <Text width={px(346)} text-align="center" font-family={mono}>rounded / round caps</Text>
          <Group width={px(346)} height={px(180)}>
            <Arrow points={[[0.08, 0.8], [0.08, 0.25], [0.65, 0.25], [0.65, 0.8], [0.92, 0.8]]}
              radius={px(18)} start-head stroke={slate} stroke-width={px(8)} stroke-linecap="round"
              head-size={px(28)} head-width={0.8} head-style={{fill: green}} />
          </Group>
        </VStack>
      </HStack>
    </VStack>
  </Box>
</Svg>
