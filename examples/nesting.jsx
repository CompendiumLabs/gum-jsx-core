// Every Box contributes its own insets. An undecorated Box adds space outside
// the white Frame; the innermost Box centers the label.
<Svg font_size={px(18)} color="#203746">
  <Box padding={px(12)} background="#dfece6" radius={px(20)}>
    <Box padding={px(8)}>
      <Frame padding={{ left: px(14), right: px(14), top: px(10), bottom: px(10) }}
        border_width={px(3)} border_color="#317969" background="white" radius={px(12)}>
        <Box width={px(240)} height={px(100)} padding={px(8)} align="center"
          border_width={px(1)} border_color="#c1d6ca" background="#f2f7f4" radius={px(5)}>
          <Text text_align="center" line_height={em(1.5)}>
            <Span font_weight={700}>A nested label</Span>{'\nMargins stay outside.'}
          </Text>
        </Box>
      </Frame>
    </Box>
  </Box>
</Svg>
