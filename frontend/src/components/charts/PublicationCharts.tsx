import { memo, useMemo } from 'react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PublicationRow } from '../../api/types'
import { fmtDateTime, fmtDay, fmtHours, fmtMW, fmtSignedMW, fmtTime } from '../../lib/format'
import { axisTick, mwTick, useChartColors } from './chartTheme'

/** How the forecast for ONE delivery interval evolved across publication times. */
export const IntervalEvolutionChart = memo(function IntervalEvolutionChart({
  rows,
  cutoffUtc,
  actual,
}: {
  rows: PublicationRow[]
  cutoffUtc: string
  actual: number | null
}) {
  const c = useChartColors()
  const data = useMemo(
    () => rows.map((r) => ({ ...r, t: Date.parse(r.publish_time) })).sort((a, b) => a.t - b.t),
    [rows],
  )
  const cutoffT = Date.parse(cutoffUtc)
  const eligible = data.filter((d) => d.eligible && !d.selected)
  const selected = data.filter((d) => d.selected)
  const later = data.filter((d) => !d.eligible)
  const domain: [number, number] = data.length ? [data[0].t, Math.max(data[data.length - 1].t, cutoffT)] : [0, 1]
  // Include the actual in the y-range so its reference line is always visible.
  const values = data.map((d) => d.forecast_mw).concat(actual !== null ? [actual] : [])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max(200, (hi - lo) * 0.08)
  const yDomain: [number, number] = [Math.floor((lo - pad) / 100) * 100, Math.ceil((hi + pad) / 100) * 100]
  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 20, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            tickFormatter={(t) => `${fmtDay(new Date(t).toISOString())} ${fmtTime(new Date(t).toISOString())}`}
            tick={axisTick(c)}
            stroke={c.axis}
            minTickGap={40}
          />
          <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} domain={yDomain} />
          <Tooltip
            cursor={{ stroke: c.axis }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const r = payload[0].payload as PublicationRow
              return (
                <div className="tooltip">
                  <div className="tooltip-title">Published {fmtDateTime(r.publish_time)} UK</div>
                  <div className="tooltip-row">
                    <span>Forecast</span>
                    <strong>{fmtMW(r.forecast_mw)}</strong>
                  </div>
                  <div className="tooltip-row">
                    <span>Error vs actual</span>
                    <strong>{fmtSignedMW(r.error_mw)}</strong>
                  </div>
                  <div className="tooltip-row">
                    <span>Lead time</span>
                    <span>{fmtHours(r.horizon_hours)}</span>
                  </div>
                  <div className="tooltip-row">
                    <span>Status</span>
                    <span>{r.selected ? 'Selected (used for decision)' : r.eligible ? 'Eligible, superseded' : 'After cutoff — not available'}</span>
                  </div>
                </div>
              )
            }}
          />
          <ReferenceLine
            x={cutoffT}
            stroke={c.accent}
            strokeWidth={1.5}
            label={{ value: 'Decision cutoff', position: 'top', fill: c.accent, fontSize: 11.5 }}
          />
          {actual !== null && (
            <ReferenceLine
              y={actual}
              stroke={c.actual}
              strokeWidth={1.5}
              label={{ value: `Actual ${fmtMW(actual)}`, position: 'insideTopLeft', fill: c.actual, fontSize: 11.5 }}
            />
          )}
          <Line dataKey="forecast_mw" stroke={c.muted} strokeWidth={1} dot={false} isAnimationActive={false} activeDot={false} />
          <Scatter data={eligible} dataKey="forecast_mw" fill={c.forecast} isAnimationActive={false} name="Eligible" />
          <Scatter data={later} dataKey="forecast_mw" fill={c.muted} isAnimationActive={false} name="After cutoff" />
          <Scatter
            data={selected}
            dataKey="forecast_mw"
            fill={c.forecast}
            stroke={c.surface}
            strokeWidth={2}
            shape={(p: { cx?: number; cy?: number }) => (
              <g>
                <circle cx={p.cx} cy={p.cy} r={8} fill="none" stroke={c.forecast} strokeWidth={2} />
                <circle cx={p.cx} cy={p.cy} r={4} fill={c.forecast} />
              </g>
            )}
            isAnimationActive={false}
            name="Selected"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

/** All publications' forecast curves for the delivery day; selected one highlighted, others greyed. */
export const DayCurvesChart = memo(function DayCurvesChart({
  rows,
  actuals,
}: {
  rows: PublicationRow[]
  actuals: { start_time: string; actual_mw: number | null }[]
}) {
  const c = useChartColors()
  const { curves, actualData, selectedPub, latestPub } = useMemo(() => {
    const byPub = new Map<string, { t: number; v: number }[]>()
    let selectedPub: string | null = null
    for (const r of rows) {
      if (!byPub.has(r.publish_time)) byPub.set(r.publish_time, [])
      byPub.get(r.publish_time)!.push({ t: Date.parse(r.start_time), v: r.forecast_mw })
      if (r.selected) selectedPub = r.publish_time
    }
    const pubs = [...byPub.keys()].sort()
    // Latest publication that forecasts every hour of the day (hindsight reference only).
    const fullDay = Math.max(0, ...pubs.map((p) => byPub.get(p)!.length))
    const latestPub = [...pubs].reverse().find((p) => byPub.get(p)!.length === fullDay) ?? null
    const curves = pubs.map((p) => ({ pub: p, data: byPub.get(p)!.sort((a, b) => a.t - b.t) }))
    const actualData = actuals.map((a) => ({ t: Date.parse(a.start_time), v: a.actual_mw }))
    return { curves, actualData, selectedPub, latestPub }
  }, [rows, actuals])
  const domain: [number, number] = actualData.length ? [actualData[0].t, actualData[actualData.length - 1].t] : [0, 1]
  return (
    <div>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        <span>
          <span className="swatch-line" style={{ background: c.actual }} /> Actual
        </span>
        <span>
          <span className="swatch-line" style={{ background: c.forecast }} /> Selected day-ahead publication
          {selectedPub ? ` (${fmtDateTime(selectedPub)})` : ''}
        </span>
        {latestPub && latestPub !== selectedPub && (
          <span>
            <span className="swatch-line" style={{ background: c.alt }} /> Latest publication covering the whole day ({fmtDateTime(latestPub)}) — hindsight
          </span>
        )}
        <span>
          <span className="swatch-line" style={{ background: c.axis }} /> Other publications
        </span>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <LineChart margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              allowDuplicatedCategory={false}
              tickFormatter={(t) => fmtTime(new Date(t).toISOString())}
              tick={axisTick(c)}
              stroke={c.axis}
              minTickGap={24}
            />
            <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} domain={['auto', 'auto']} />
            {curves
              .filter((cv) => cv.pub !== selectedPub && cv.pub !== latestPub)
              .map((cv) => (
                <Line
                  key={cv.pub}
                  data={cv.data}
                  dataKey="v"
                  stroke={c.axis}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={false}
                />
              ))}
            {latestPub && latestPub !== selectedPub && (
              <Line
                data={curves.find((cv) => cv.pub === latestPub)!.data}
                dataKey="v"
                stroke={c.alt}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            {selectedPub && (
              <Line
                data={curves.find((cv) => cv.pub === selectedPub)!.data}
                dataKey="v"
                stroke={c.forecast}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            <Line data={actualData} dataKey="v" stroke={c.actual} strokeWidth={2} dot={false} isAnimationActive={false} activeDot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
