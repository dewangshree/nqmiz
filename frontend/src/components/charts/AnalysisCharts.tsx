import { memo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Daily, Metrics } from '../../api/types'
import { fmtDate, fmtInt, fmtMW, fmtSignedMW } from '../../lib/format'
import { axisTick, mwTick, useChartColors, type ChartColors } from './chartTheme'

type Row = Record<string, string | number | null>

function SimpleTooltip({
  active,
  payload,
  title,
  rows,
}: {
  active?: boolean
  payload?: { payload: Row }[]
  title: (r: Row) => string
  rows: (r: Row) => { label: string; value: string; color?: string }[]
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="tooltip">
      <div className="tooltip-title">{title(r)}</div>
      {rows(r).map((x) => (
        <div className="tooltip-row" key={x.label}>
          <span className="k">
            {x.color && <span className="swatch-line" style={{ background: x.color }} />}
            {x.label}
          </span>
          <strong>{x.value}</strong>
        </div>
      ))}
    </div>
  )
}

const legendStyle = (c: ChartColors) => ({ fontSize: 12, color: c.text, paddingTop: 6 })

/** Daily average actual vs daily average forecast over matched intervals. */
export const DailyAverageChart = memo(function DailyAverageChart({ daily, height = 260 }: { daily: Daily[]; height?: number }) {
  const c = useChartColors()
  const data = daily.map((d) => ({
    date: d.delivery_date,
    actual: d.metrics.mean_actual_mw,
    forecast: d.metrics.mean_forecast_mw,
    mae: d.metrics.mae_mw,
    n: d.metrics.n,
  }))
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={axisTick(c)} stroke={c.axis} minTickGap={20} />
          <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} />
          <Tooltip
            cursor={{ stroke: c.axis }}
            content={
              <SimpleTooltip
                title={(r) => fmtDate(String(r.date), true)}
                rows={(r) => [
                  { label: 'Mean actual', value: fmtMW(r.actual as number), color: c.actual },
                  { label: 'Mean forecast', value: fmtMW(r.forecast as number), color: c.forecast },
                  { label: 'MAE', value: fmtMW(r.mae as number) },
                  { label: 'Matched intervals', value: fmtInt(r.n as number) },
                ]}
              />
            }
          />
          <Legend wrapperStyle={legendStyle(c)} iconType="plainline" />
          <Line dataKey="actual" name="Actual (daily mean MW)" stroke={c.actual} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
          <Line dataKey="forecast" name="Day-ahead forecast (daily mean MW)" stroke={c.forecast} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})

/** Diverging bars: positive = overforecast, negative = underforecast. */
export const DailyBiasChart = memo(function DailyBiasChart({ daily, height = 220 }: { daily: Daily[]; height?: number }) {
  const c = useChartColors()
  const data = daily.map((d) => ({ date: d.delivery_date, bias: d.metrics.bias_mw, mae: d.metrics.mae_mw, rmse: d.metrics.rmse_mw, n: d.metrics.n }))
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={axisTick(c)} stroke={c.axis} minTickGap={20} />
          <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} />
          <ReferenceLine y={0} stroke={c.axis} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={
              <SimpleTooltip
                title={(r) => fmtDate(String(r.date), true)}
                rows={(r) => [
                  { label: 'Bias (mean F − A)', value: fmtSignedMW(r.bias as number) },
                  { label: 'MAE', value: fmtMW(r.mae as number) },
                  { label: 'RMSE', value: fmtMW(r.rmse as number) },
                  { label: 'n', value: fmtInt(r.n as number) },
                ]}
              />
            }
          />
          <Bar dataKey="bias" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.date} fill={(d.bias ?? 0) >= 0 ? c.over : c.under} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
})

/** Daily MAE and RMSE - same unit, one axis. */
export const DailyErrorChart = memo(function DailyErrorChart({ daily, height = 240 }: { daily: Daily[]; height?: number }) {
  const c = useChartColors()
  const data = daily.map((d) => ({ date: d.delivery_date, mae: d.metrics.mae_mw, rmse: d.metrics.rmse_mw, n: d.metrics.n }))
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => fmtDate(d)} tick={axisTick(c)} stroke={c.axis} minTickGap={20} />
          <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={
              <SimpleTooltip
                title={(r) => fmtDate(String(r.date), true)}
                rows={(r) => [
                  { label: 'MAE', value: fmtMW(r.mae as number), color: c.actual },
                  { label: 'RMSE', value: fmtMW(r.rmse as number), color: c.alt },
                  { label: 'n', value: fmtInt(r.n as number) },
                ]}
              />
            }
          />
          <Legend wrapperStyle={legendStyle(c)} />
          <Bar dataKey="mae" name="MAE (MW)" fill={c.actual} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line dataKey="rmse" name="RMSE (MW)" stroke={c.alt} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

export const ErrorHistogram = memo(function ErrorHistogram({
  bins,
  height = 240,
}: {
  bins: { bin_start: number; bin_end: number; count: number }[]
  height?: number
}) {
  const c = useChartColors()
  const total = bins.reduce((s, b) => s + b.count, 0)
  const data = bins.map((b) => ({ ...b, mid: (b.bin_start + b.bin_end) / 2, label: `${mwTick(b.bin_start)}…${mwTick(b.bin_end)}` }))
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap={2}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="bin_start" tickFormatter={(v) => mwTick(v)} tick={axisTick(c)} stroke={c.axis} minTickGap={16} />
          <YAxis tick={axisTick(c)} stroke={c.axis} width={40} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={
              <SimpleTooltip
                title={(r) => `${fmtSignedMW(r.bin_start as number)} to ${fmtSignedMW(r.bin_end as number)}`}
                rows={(r) => [
                  { label: 'Intervals', value: fmtInt(r.count as number) },
                  { label: 'Share', value: total ? `${(((r.count as number) / total) * 100).toFixed(1)}%` : '—' },
                ]}
              />
            }
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.bin_start} fill={d.bin_start >= 0 ? c.over : c.under} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
})

/** MAE bars and bias line by UK hour of day - both MW on one axis. */
export const HourProfileChart = memo(function HourProfileChart({
  byHour,
  height = 240,
}: {
  byHour: { hour_local: number; metrics: Metrics }[]
  height?: number
}) {
  const c = useChartColors()
  const data = byHour.map((h) => ({
    hour: `${String(h.hour_local).padStart(2, '0')}:00`,
    mae: h.metrics.mae_mw,
    bias: h.metrics.bias_mw,
    n: h.metrics.n,
  }))
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="hour" tick={axisTick(c)} stroke={c.axis} interval={2} />
          <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} />
          <ReferenceLine y={0} stroke={c.axis} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={
              <SimpleTooltip
                title={(r) => `${r.hour} UK`}
                rows={(r) => [
                  { label: 'MAE', value: fmtMW(r.mae as number), color: c.actual },
                  { label: 'Bias', value: fmtSignedMW(r.bias as number), color: c.forecast },
                  { label: 'n', value: fmtInt(r.n as number) },
                ]}
              />
            }
          />
          <Legend wrapperStyle={legendStyle(c)} />
          <Bar dataKey="mae" name="MAE (MW)" fill={c.actual} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line dataKey="bias" name="Bias (MW)" stroke={c.forecast} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

export const HorizonChart = memo(function HorizonChart({
  byHorizon,
  height = 220,
}: {
  byHorizon: { label: string; metrics: Metrics }[]
  height?: number
}) {
  const c = useChartColors()
  const data = byHorizon.map((h) => ({ label: h.label, mae: h.metrics.mae_mw, bias: h.metrics.bias_mw, n: h.metrics.n }))
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="label" tick={axisTick(c)} stroke={c.axis} />
          <YAxis tickFormatter={mwTick} tick={axisTick(c)} stroke={c.axis} width={44} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.5 }}
            content={
              <SimpleTooltip
                title={(r) => `Lead time ${r.label}`}
                rows={(r) => [
                  { label: 'MAE', value: fmtMW(r.mae as number), color: c.actual },
                  { label: 'Bias', value: fmtSignedMW(r.bias as number) },
                  { label: 'n', value: fmtInt(r.n as number) },
                ]}
              />
            }
          />
          <Bar dataKey="mae" name="MAE (MW)" fill={c.actual} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
})
