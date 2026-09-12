// A sampled curve, uncertainty band, observations, and a measured legend.
const wave = x => sin(x) * exp(-x / 9);
const observations = linspace(0.4, 11.8, 15).map((x, i) => ({ x, y: wave(x) + 0.08 * cos(i * 3) }));
return <Svg width={px(680)} height={px(420)}>
  <Plot title="A damped oscillation" xlabel="Time (s)" ylabel="Amplitude"
    xlim={[0, 12]} ylim={[-1.3, 1.3]} background="white"
    legend={[{ label: 'Model', color: '#2563eb' }, { label: 'Observations', kind: 'point', color: '#e8793c' }]}>
    <SymFill xlim={[0, 12]} upper={x => wave(x) + 0.16} lower={x => wave(x) - 0.16} fill="#dbeafe" />
    <SymLine xlim={[0, 12]} fy={wave} samples={241} stroke="#2563eb" stroke_width={px(2.5)} />
    <Points points={observations} fill="#e8793c" point_size={px(7)} />
  </Plot>
</Svg>;
