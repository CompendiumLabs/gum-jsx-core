// A slide composes a measured title, figure, and caption at a stable type scale.
return <Svg width={px(960)} height={px(540)}>
  <Slide title="From samples to a figure" font_size={px(18)}>
    <TextFigure caption="A common sampler supports scalar functions and parametric curves."
      caption_style={{ color: '#64748b', font_size: px(14) }}>
      <Plot height={px(325)} title="Sine and cosine" xlabel="Phase (rad)" ylabel="Value"
        xlim={[0, tau]} ylim={[-1.2, 1.2]}>
        <SymLine fy={sin} xlim={[0, tau]} stroke="#2563eb" stroke_width={px(2.5)} />
        <SymSpline fy={cos} xlim={[0, tau]} samples={17} stroke="#e8793c" stroke_width={px(2.5)} />
      </Plot>
    </TextFigure>
  </Slide>
</Svg>;
