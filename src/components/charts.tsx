// Small, dependency-free SVG charts. Every chart in this app is rendered
// only from data that was actually fetched — there is no synthetic/sample
// data path. Callers are responsible for showing an EmptyState instead of
// mounting these when there isn't enough real data to plot.

interface BarDatum {
  label: string
  value: number
}

export function BarChart({ data, valueFormatter }: { data: BarDatum[]; valueFormatter?: (v: number) => string }) {
  const W = 640
  const H = 180
  const PAD = { top: 10, right: 8, bottom: 24, left: 8 }
  const max = Math.max(...data.map((d) => d.value), 1)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const barGap = 6
  const barW = data.length > 0 ? innerW / data.length - barGap : 0

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 320, display: 'block' }}>
        {data.map((d, i) => {
          const barH = max > 0 ? (d.value / max) * innerH : 0
          const x = PAD.left + i * (barW + barGap)
          const y = PAD.top + (innerH - barH)
          return (
            <g key={d.label + i}>
              <rect x={x} y={y} width={Math.max(barW, 2)} height={Math.max(barH, 1)} rx={3} fill="#00d97e" opacity={0.85}>
                <title>{`${d.label}: ${valueFormatter ? valueFormatter(d.value) : d.value}`}</title>
              </rect>
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="8" fill="#5b6478" fontFamily="ui-monospace, monospace">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface DonutDatum {
  label: string
  value: number
  color: string
}

export function DonutChart({ data, centerLabel, centerValue }: { data: DonutDatum[]; centerLabel?: string; centerValue?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const CX = 90
  const CY = 90
  const R = 72
  const INNER = 44
  if (total <= 0) return null
  const { slices } = data.reduce<{ angle: number; slices: (DonutDatum & { path: string })[] }>(
    (acc, d) => {
      const sweep = (d.value / total) * 2 * Math.PI
      const x1 = CX + R * Math.cos(acc.angle)
      const y1 = CY + R * Math.sin(acc.angle)
      const endAngle = acc.angle + sweep
      const x2 = CX + R * Math.cos(endAngle)
      const y2 = CY + R * Math.sin(endAngle)
      const largeArc = sweep > Math.PI ? 1 : 0
      const path = `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} Z`
      return { angle: endAngle, slices: [...acc.slices, { ...d, path }] }
    },
    { angle: -Math.PI / 2, slices: [] },
  )

  return (
    <svg viewBox="0 0 180 180" style={{ width: '100%', maxWidth: 220, display: 'block', margin: '0 auto' }}>
      {slices.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="#12161f" strokeWidth="1.5">
          <title>{`${s.label}: ${((s.value / total) * 100).toFixed(1)}%`}</title>
        </path>
      ))}
      <circle cx={CX} cy={CY} r={INNER} fill="#12161f" />
      {centerLabel && (
        <text x={CX} y={CY - 4} textAnchor="middle" fill="#e7ebf3" fontSize="11" fontWeight="700" fontFamily="ui-monospace, monospace">
          {centerLabel}
        </text>
      )}
      {centerValue && (
        <text x={CX} y={CY + 12} textAnchor="middle" fill="#97a1b5" fontSize="9" fontFamily="ui-monospace, monospace">
          {centerValue}
        </text>
      )}
    </svg>
  )
}
