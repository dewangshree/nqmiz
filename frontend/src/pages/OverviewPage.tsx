import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { AsyncView, ContextBanner, MetricKpis, SourceFreshness, UnmatchedNotice } from '../components/analysis'
import { DailyAverageChart, DailyBiasChart } from '../components/charts/AnalysisCharts'
import { Card, Notice, SkeletonKpis } from '../components/ui/primitives'
import { useAnalysisParams } from '../hooks/useAnalysisParams'
import { useApi } from '../hooks/useApi'
import { fmtGW, fmtInt } from '../lib/format'

export default function OverviewPage() {
  const { query, queryKey, params } = useAnalysisParams()
  const state = useApi(`overview|${queryKey}`, (signal) => api.overview(query, signal))
  const search = params.toString() ? `?${params}` : ''

  return (
    <AsyncView state={state} loading={<SkeletonKpis />}>
      {(d) => (
        <>
          <ContextBanner context={d.context} coverage={d.coverage} />
          <MetricKpis metrics={d.metrics} coverage={d.coverage} />
          <UnmatchedNotice coverage={d.coverage} />
          <div className="grid grid-3-1">
            <Card
              title="Daily average generation: actual vs day-ahead forecast"
              subtitle="Daily mean MW over matched intervals. Hover a day for its error; open Forecast vs actual for interval detail."
              actions={
                <Link className="btn" to={`/forecast-vs-actual${search}`}>
                  Interval detail
                </Link>
              }
            >
              <DailyAverageChart daily={d.daily} height={380} />
            </Card>
            <Card title="What the data shows" subtitle="Generated from the computed results for the selected filters.">
              <ul className="insights">
                {d.insights.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <div style={{ marginTop: 16 }}>
                <Notice>
                  Forecast error is not the same as a procurement shortfall: demand, other generation and prices are outside
                  this dataset. Use these figures as a measure of wind forecast uncertainty only.
                </Notice>
              </div>
            </Card>
          </div>
          <div className="grid grid-2">
            <Card
              title="Daily forecast bias"
              subtitle="Mean forecast − actual per day. Red = overforecast, blue = underforecast."
              actions={
                <Link className="btn" to={`/accuracy${search}`}>
                  Error analysis
                </Link>
              }
            >
              <DailyBiasChart daily={d.daily} />
            </Card>
            <Card title="Coverage and units" subtitle="How the figures above are defined.">
              <dl className="kv">
                <dt>Evaluated intervals</dt>
                <dd className="tabular">
                  {fmtInt(d.coverage.evaluated_intervals)} of {fmtInt(d.coverage.total_half_hours)} delivery half-hours
                </dd>
                <dt>Matched pairs</dt>
                <dd className="tabular">{fmtInt(d.coverage.matched)}</dd>
                <dt>Actual half-hours available</dt>
                <dd className="tabular">{fmtInt(d.coverage.actual_half_hours_available)}</dd>
                <dt>Actual wind energy</dt>
                <dd className="tabular">
                  {d.coverage.actual_energy_gwh !== null ? `${fmtInt(d.coverage.actual_energy_gwh)} GWh` : '—'}{' '}
                  <span className="muted">(Σ half-hour MW × 0.5 h, all half-hours)</span>
                </dd>
                <dt>Mean actual</dt>
                <dd className="tabular">{fmtGW(d.metrics.mean_actual_mw)}</dd>
                <dt>Units</dt>
                <dd>Generation values are average MW for each interval; MW are never summed as energy.</dd>
                <dt>Over / under</dt>
                <dd className="tabular">
                  {fmtInt(d.metrics.over_count)} overforecast · {fmtInt(d.metrics.under_count)} underforecast ·{' '}
                  {fmtInt(d.metrics.exact_count)} exact
                </dd>
              </dl>
            </Card>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            <SourceFreshness sources={d.context.sources} />
          </p>
        </>
      )}
    </AsyncView>
  )
}
