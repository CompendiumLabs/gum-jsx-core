// The Square sets the size. Box adds 16px padding and a 2px border per side;
// Svg adopts the resulting 100×100 box without an explicit viewport.
<Svg>
  <Box padding={em(1)} border_width={px(2)} border_color="#267667"
    background="#e9f5ef" radius={px(12)}>
    <Square width={px(64)} fill="#63b49d" stroke="none" />
  </Box>
</Svg>
