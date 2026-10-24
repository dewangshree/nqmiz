import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Daily, Interval, Metrics } from '../api/types'
import { AsyncView, MetricKpis, SourceFreshness, UnmatchedNotice } from '../components/analysis'
import {
  DailyBiasChart,
  DailyErrorChart,
  ErrorHistogram,
  HorizonChart,
  HourProfileChart,
} from '../components/charts/AnalysisCharts'
import { DataTable, type Column } from '../components/ui/DataTable'
import { Card, Notice, SkeletonKpis } from '../components/ui/primitives'
import { useAnalysisParams } from '../hooks/useAnalysisParams'
import { useApi } from '../hooks/useApi'
import { fmtDate, fmtDateTime, fmtHours, fmtInt, fmtMW, fmtPct, fmtSignedMW } from '../lib/format'

const DAILY_COLUMNS: Column<Daily>[] = [
  { key: 'd', header: 'Delivery day', render: (d) => fmtDate(d.delivery_date, true), sortValue: (d) => d.delivery_date },
  {
    key: 'pub',
    header: 'Forecast used',
    render: (d) => d.selected_publications.map((p) => fmtDateTime(p)).join(', ') || '—',
  },
  { key: 'n', header: 'n', render: (d) => fmtInt(d.metrics.n), sortValue: (d) => d.metrics.n, numeric: true },
  { key: 'a', header: 'Mean actual', render: (d) => fmtMW(d.metrics.mean_actual_mw), sortValue: (d) => d.metrics.mean_actual_mw, numeric: true },
  { key: 'f', header: 'Mean forecast', render: (d) => fmtMW(d.metrics.mean_forecast_mw), sortValue: (d) => d.metrics.mean_forecast_mw, numeric: true },
  { key: 'mae', header: 'MAE', render: (d) => fmtMW(d.metrics.mae_mw), sortValue: (d) => d.metrics.mae_mw, numeric: true },
  { key: 'rmse', header: 'RMSE', render: (d) => fmtMW(d.metrics.rmse_mw), sortValue: (d) => d.metrics.rmse_mw, numeric: true },
  { key: 'bias', header: 'Bias', render: (d) => fmtSignedMW(d.metrics.bias_mw), sortValue: (d) => d.metrics.bias_mw, numeric: true },
  { key: 'nmae', header: 'nMAE', render: (d) => fmtPct(d.metrics.nmae_pct), sortValue: (d) => d.metrics.nmae_pct, numeric: true },
]

const LARGEST_COLUMNS: Column<Interval>[] = [
  { key: 't', header: 'Delivery (UK)', render: (i) => fmtDateTime(i.start_time) },
  { key: 'a', header: 'Actual', render: (i) => fmtMW(i.actual_mw), numeric: true },
  { key: 'f', header: 'Forecast', render: (i) => fmtMW(i.forecast_mw), numeric: true },
  { key: 'e', header: 'Error', render: (i) => fmtSignedMW(i.error_mw), numeric: true },
  { key: 'h', header: 'Lead', render: (i) => fmtHours(i.horizon_hours), numeric: true },
]

function BenchmarkTable({ dayAhead, latest }: { dayAhead: Metrics; latest: Metrics }) {
  const rows: { label: string; a: string; b: string }[] = [
    { label: 'Intervals (n)', a: fmtInt(dayAhead.n), b: fmtInt(latest.n) },
    { label: 'MAE', a: fmtMW(dayAhead.mae_mw), b: fmtMW(latest.mae_mw) },
    { label: 'RMSE', a: fmtMW(dayAhead.rmse_mw), b: fmtMW(latest.rmse_mw) },
    { label: 'Bias', a: fmtSignedMW(dayAhead.bias_mw), b: fmtSignedMW(latest.bias_mw) },
  ]
  return (
    <table className="data">
      <caption className="visually-hidden">Day-ahead forecast versus latest forecast before delivery</caption>
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col" className="num">
            Day-ahead (used)
          </th>
          <th scope="col" className="num">
            Latest before delivery
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td className="num">
              <strong>{r.a}</strong>
            </td>
            <td className="num muted">{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function AccuracyPage() {
  const { query, queryKey, params } = useAnalysisParams()
  const navigate = useNavigate()
  const state = useApi(`accuracy|${queryKey}`, (signal) => api.accuracy(query, signal))

  return (
    <AsyncView state={state} loading={<SkeletonKpis count={5} />}>
      {(d) => {
        const m = d.metrics
        const overShare = m.n ? (m.over_count / m.n) * 100 : null
        return (
          <>
            <MetricKpis metrics={m} coverage={d.coverage} />
            <UnmatchedNotice coverage={d.coverage} />
            <div className="grid grid-2">
              <Card title="Daily MAE and RMSE" subtitle={`Per delivery day over matched intervals. n = ${fmtInt(m.n)} intervals in total.`}>
                <DailyErrorChart daily={d.daily} />
              </Card>
              <Card
                title="Daily bias: over- vs underforecasting"
                subtitle="Mean forecast − actual per day. Red bars = forecast too high; blue bars = forecast too low."
              >
                <DailyBiasChart daily={d.daily} height={240} />
              </Card>
            </div>
            <div className="grid grid-2">
              <Card
                title="Distribution of interval errors"
                subtitle="Count of matched intervals by error (forecast − actual), 500 MW bins."
                footer={
                  <span className="tabular">
                    P10 {fmtSignedMW(m.p10_error_mw)} · median {fmtSignedMW(m.p50_error_mw)} · P90 {fmtSignedMW(m.p90_error_mw)} ·{' '}
                    {fmtPct(overShare, 0)} overforecast ({fmtInt(m.over_count)}) · {fmtInt(m.under_count)} underforecast
                  </span>
                }
              >
                <ErrorHistogram bins={d.error_histogram} />
              </Card>
              <Card
                title="Error by hour of day (UK)"
                subtitle="MAE (bars) and bias (line) by delivery hour, both in MW. Sample size per hour shown on hover."
              >
                <HourProfileChart byHour={d.by_hour} />
              </Card>
            </div>
            <div className="grid grid-2">
              <Card
                title="Error by forecast lead time"
                subtitle="Lead time = delivery start − publication time of the forecast actually used. Day-ahead selection limits it to roughly 14–38 h."
              >
                <HorizonChart byHorizon={d.by_horizon} />
              </Card>
              <Card
                title="How much did forecasts improve after the cutoff?"
                subtitle="Hindsight comparison only — the right-hand column was not available when the purchase was made."
              >
                <BenchmarkTable dayAhead={d.benchmark.day_ahead} latest={d.benchmark.latest_before_delivery} />
                <div style={{ marginTop: 12 }}>
                  <Notice>{d.benchmark.description}</Notice>
                </div>
              </Card>
            </div>
            <div className="stack">
              <Card
                title="Daily accuracy summary"
                subtitle="Sortable. Select a day to open its interval detail."
                footer={<SourceFreshness sources={d.context.sources} />}
              >
                <DataTable
                  key={queryKey}
                  rows={d.daily}
                  columns={DAILY_COLUMNS}
                  rowKey={(r) => r.delivery_date}
                  initialSort={{ key: 'd', dir: 'asc' }}
                  pageSize={12}
                  caption="Daily forecast accuracy"
                  onRowClick={(r) => {
                    const next = new URLSearchParams(params)
                    next.set('start', r.delivery_date)
                    next.set('end', r.delivery_date)
                    navigate({ pathname: '/forecast-vs-actual', search: `?${next}` })
                  }}
                />
              </Card>
              <Card title="Largest misses" subtitle="Ten matched intervals with the largest absolute error.">
                <DataTable rows={d.largest_errors} columns={LARGEST_COLUMNS} rowKey={(i) => i.start_time} caption="Largest errors" pageSize={12} />
              </Card>
            </div>
          </>
        )
      }}
    </AsyncView>
  )
}
