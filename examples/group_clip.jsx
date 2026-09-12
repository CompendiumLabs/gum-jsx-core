// Both canvases query the same immutable artwork. The second clips painted ink;
// its fragment tree still records the full positioned allocations and overflow.
const artwork = [
  <Rect fill={lightgray} stroke={none} />,
  <Rect x={px(-14)} y={0.28} width={px(76)} height={px(44)} fill={blue} stroke={none} />,
  <Circle x={0.88} y={0.5} anchor="center" width={px(88)} fill={red} stroke={none} />,
];

return <Svg color={slate}>
  <Box padding={px(24)} background={white}>
    <HStack gap={px(36)}>
      {[false, true].map(clip => <VStack gap={px(10)}>
        <Text font_size={px(14)} font_weight={bold}>clip = {String(clip)}</Text>
        <Box border_width={px(2)} border_color={slate}>
          <Group width={px(180)} height={px(100)} clip={clip}>{artwork}</Group>
        </Box>
      </VStack>)}
    </HStack>
  </Box>
</Svg>;
