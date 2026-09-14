// Main-axis allocation and cross-axis alignment are separate. Each bar is a Box
// with ordinary child flex metadata; the stack only allocates its border box.
function Bar({ label, color, ...props }) {
  return <Box height={px(40)} align="center" background={color} radius={px(5)} {...props}>
    <Text color={white} font_size={px(14)} font_weight={bold}>{label}</Text>
  </Box>
}

return <Svg width={px(560)} color={slate}>
  <Box width={1} padding={px(20)} background={white}>
    <VStack width={1} gap={px(18)}>
      <Text font_size={px(24)} font_weight={bold}>Where the space goes</Text>
      <VStack width={1} gap={px(6)}>
        <Text font_size={px(13)}>Zero bases, growth weights 1 : 2 : 1</Text>
        <HStack gap={px(8)}>
          <Bar basis={0} grow={1} color={blue} label="1" />
          <Bar basis={0} grow={2} color={red} label="2" />
          <Bar basis={0} grow={1} color={green} label="1" />
        </HStack>
      </VStack>
      <VStack width={1} gap={px(6)}>
        <Text font_size={px(13)}>The middle bar stops at 120px; its neighbors share the rest</Text>
        <HStack gap={px(8)}>
          <Bar basis={0} grow={1} color={blue} label="192px" />
          <Bar basis={0} grow={2} max_width={px(120)} color={red} label="120px max" />
          <Bar basis={0} grow={1} color={green} label="192px" />
        </HStack>
      </VStack>
      <VStack width={1} gap={px(6)}>
        <Text font_size={px(13)}>300px bases shrink equally to fit, including the 8px gap</Text>
        <HStack width={1} gap={px(8)}>
          <Bar basis={px(300)} shrink={1} color={blue} label="256px" />
          <Bar basis={px(300)} shrink={1} color={red} label="256px" />
        </HStack>
      </VStack>
      <HStack width={1} gap={px(8)} align="center">
        <Text font_size={px(13)}>A Spacer takes the remainder</Text>
        <Spacer />
        <Bar width={px(88)} color={blue} label="At the end" />
      </HStack>
    </VStack>
  </Box>
</Svg>
