// This child deliberately overflows. Clip keeps its ink inside the rounded
// border; the tree still records the child's full size and overflow.
<Svg>
  <Box margin={px(12)} width={px(220)} height={px(100)} padding={px(12)}
    border_width={px(6)} border_color="#317969" background="#e9f5ef"
    radius={px(28)} align="center" clip>
    <Square width={px(280)} fill="#f0bd79" stroke="#a46c31" stroke_width={px(2)} />
  </Box>
</Svg>
