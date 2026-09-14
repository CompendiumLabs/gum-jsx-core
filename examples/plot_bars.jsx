// Categorical ticks, positive and negative bars, and functional bar colors.
const values = [28, 43, -17, 56, 34]
return <Svg width={px(640)} height={px(380)}>
  <BarPlot values={values} title="Change by region" xlabel="Region" ylabel="Change (%)"
    xticks={enumerate(['North', 'East', 'Central', 'South', 'West'])}
    styles={value => ({ fill: value < 0 ? '#e8793c' : '#0d9488' })}
    radius={px(4)} background="white" padding={[0.12, 0.1]}>
    <CoordLine points={[{ x: -0.6, y: 0 }, { x: 4.6, y: 0 }]} stroke="#334155" />
  </BarPlot>
</Svg>
