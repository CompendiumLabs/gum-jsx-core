// Vector direction is mapped through the graph before fixed-size arrowheads are drawn.
return <Svg width={px(600)} height={px(480)}>
  <Plot title="Rotation field" xlabel="x" ylabel="y" xlim={[-2.4, 2.4]} ylim={[-2.4, 2.4]}
    background="white" aspect={1.25}>
    <SymField f={(x, y) => [-y, x]} xlim={[-2, 2]} ylim={[-2, 2]} samples={11}
      scale={0.14} stroke="#0f766e" stroke_width={px(1.5)} head_size={px(5)} />
    <SymLine f={t => [1.25 * Math.cos(t), 1.25 * Math.sin(t)]} tlim={[0, 2 * pi]}
      stroke="#e8793c" stroke_width={px(2.5)} />
  </Plot>
</Svg>;
