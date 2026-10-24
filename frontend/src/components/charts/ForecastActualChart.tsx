import { memo, useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Interval } from '../../api/types'
import { STATUS_LABEL, fmtDateTime, fmtDay, fmtHours, fmtMW, fmtSignedMW, fmtTime } from '../../lib/format'
import { axisTick, mwTick, useChartColors, type ChartColors } from './chartTheme'

interface Point {
  t: number
  actual: number | null
}
interface ForecastPoint {
  t: number
  forecast: number | null
}

function buildSeries(intervals: Interval[]) {
  const actual: Point[] = []
  const forecast: ForecastPoint[] = []
  const errors: { t: number; error: number | null }[] = []
  const byT = new Map<number, Interval>()
  for (const i of intervals) {
    const t = Date.parse(i.start_time)
    byT.set(t, i)
    actual.push({ t, actual: i.actual_mw })
    // Only evaluated intervals carry a forecast slot, so genuinely missing
    // forecasts render as gaps while :30 slots in hourly mode are simply skipped.
    if (i.status !== 'not_evaluated') {
      forecast.push({ t, forecast: i.forecast_mw })
      errors.push({ t, error: i.error_mw })
    }
  }
  return { actual, forecast, errors, byT }
}

function tickFormatter(spanDays: number) {
  return (t: number) => (spanDays <= 2 ? fmtTime(new Date(t).toISOString()) : fmtDay(new Date(t).toISOString()))
}

function IntervalTooltip({
  active,
  label,
  byT,
  colors,
}: {
  active?: boolean
  label?: number
  byT: Map<number, Interval>
  colors: ChartColors
}) {
  if (!active || label === undefined) return null
  const i = byT.get(label)
  if (!i) return null
  return (
    <div className="tooltip">
      <div className="tooltip-title">{fmtDateTime(i.start_time)} UK</div>
      <div className="tooltip-row">
        <span className="k">
          <span className="swatch-line" style={{ background: colors.actual }} />
          Actual
        </span>
        <strong>{fmtMW(i.actual_mw)}</strong>
      </div>
      <div className="tooltip-row">
        <span className="k">
          <span className="swatch-line" style={{ background: colors.forecast }} />
          Forecast{i.forecast_kind === 'interpolated' ? ' (interp.)' : ''}
        </span>
        <strong>{i.status === 'not_evaluated' ? 'n/a (hourly)' : fmtMW(i.forecast_mw)}</strong>
      </div>
      <div className="tooltip-row">
        <span className="k">Error (F − A)</span>
        <strong>{fmtSignedMW(i.error_mw)}</strong>
      </div>
      <div className="tooltip-sep" />
      {i.forecast_publish_time && (
        <div className="tooltip-row">
          <span>Published</span>
          <span>
            {fmtDateTime(i.forecast_publish_time)} · {fmtHours(i.horizon_hours)} ahead
          </span>
        </div>
      )}
      <div className="tooltip-row">
        <span>Cutoff</span>
        <span>{fmtDateTime(i.cutoff_utc)}</span>
      </div>
      {i.status !== 'matched' && (
        <div className="tooltip-row">
          <span>Status</span>
          <span>{STATUS_LABEL[i.status]}</span>
        </div>
      )}
    </div>
  )
}

/** Actual vs selected forecast (MW) with a separate error panel below - two charts, one y-scale each. */
export const ForecastActualChart = memo(function ForecastActualChart({
  intervals,
  spanDays,
}: {
  intervals: Interval[]
  spanDays: number
}) {
  const colors = useChartColors()
  const { actual, forecast, errors, byT } = useMemo(() => buildSeries(intervals), [intervals])
  const fmtTick = tickFormatter(spanDays)
  // Pad by one half-hour so edge bars in the error panel stay inside the plot.
  const PAD = 30 * 60 * 1000
  const domain: [number, number] = actual.length ? [actual[0].t - PAD, actual[actual.length - 1].t + PAD] : [0, 1]
  const tooltip = <Tooltip content={<IntervalTooltip byT={byT} colors={colors} />} cursor={{ stroke: colors.axis }} />
  const dense = intervals.length > 400

  return (
    <div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={actual} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={domain}
              tickFormatter={fmtTick}
              tick={axisTick(colors)}
              stroke={colors.axis}
              minTickGap={28}
              allowDataOverflow
            />
            <YAxis
              tickFormatter={mwTick}
              tick={axisTick(colors)}
              stroke={colors.axis}
              width={44}
              label={{ value: 'MW', angle: -90, position: 'insideLeft', fill: colors.muted, fontSize: 11, dx: 6 }}
            />
            {tooltip}
            <Line
              dataKey="actual"
              name="Actual"
              stroke={colors.actual}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }}
            />
            <Line
              data={forecast}
              dataKey="forecast"
              name="Forecast"
              stroke={colors.forecast}
              strokeWidth={2}
              dot={!dense && spanDays <= 2 ? { r: 2.5, fill: colors.forecast, strokeWidth: 0 } : false}
              isAnimationActive={false}
              activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: 6 }}>
        <div className="field-label" style={{ margin: '4px 0 2px 50px' }}>
          Error (forecast − actual), MW
        </div>
        <div style={{ width: '100%', height: 130 }}>
          <ResponsiveContainer>
            <BarChart data={errors} margin={{ top: 4, right: 12, bottom: 0, left: 4 }} barCategoryGap={dense ? 0 : 1}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={domain} tickFormatter={fmtTick} hide allowDataOverflow />
              <YAxis tickFormatter={mwTick} tick={axisTick(colors)} stroke={colors.axis} width={44} />
              <ReferenceLine y={0} stroke={colors.axis} />
              {tooltip}
              <Bar dataKey="error" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {errors.map((e) => (
                  <Cell key={e.t} fill={(e.error ?? 0) >= 0 ? colors.over : colors.under} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
})
