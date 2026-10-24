import type { ReactNode } from 'react'
import type { Context, Coverage, Metrics, SourceInfo } from '../api/types'
import type { ApiState } from '../hooks/useApi'
import { addDays, fmtDate, fmtDateTime, fmtGW, fmtInt, fmtMW, fmtPct, fmtSignedMW } from '../lib/format'
import { Icon } from './ui/Icon'
import { ErrorState, KpiCard, LoadingState, Notice } from './ui/primitives'

/**
 * Renders loading / error / populated states for an API-backed view. On refetch
 * the previous result stays visible but dimmed, avoiding layout jumps.
 */
export function AsyncView<T>({
  state,
  children,
  loading,
}: {
  state: ApiState<T>
  children: (data: T) => ReactNode
  loading?: ReactNode
}) {
  if (state.error && !state.loading) {
    return (
      <div className="card">
        <ErrorState error={state.error} onRetry={state.reload} />
      </div>
    )
  }
  if (!state.data) return <>{loading ?? <div className="card"><LoadingState /></div>}</>
  return (
    <div className={state.loading ? 'stack refetching' : 'stack'} aria-busy={state.loading}>
      {children(state.data)}
    </div>
  )
}

export function ContextBanner({ context, coverage }: { context: Context; coverage: Coverage }) {
  const decisionStart = addDays(context.start, -1)
  const decisionEnd = addDays(context.end, -1)
  return (
    <section className="card banner" aria-label="Analysis context">
      <div>
        <div className="label">Delivery period</div>
        <div className="value">
          {fmtDate(context.start)} – {fmtDate(context.end)} 2026
        </div>
        <div className="detail">
          {coverage.delivery_days} day{coverage.delivery_days === 1 ? '' : 's'} · decisions {fmtDate(decisionStart)} – {fmtDate(decisionEnd)}
        </div>
      </div>
      <div>
        <div className="label">Forecast selection</div>
        <div className="value">Latest WINDFOR published before {context.cutoff.local_time} UK on D-1</div>
        <div className="detail">{context.cutoff.id === 'n2ex' ? 'N2EX' : 'EPEX SPOT'} day-ahead gate closure · no look-ahead</div>
      </div>
      <div>
        <div className="label">Intervals evaluated</div>
        <div className="value">{context.alignment.id === 'native' ? 'Hourly published points' : 'All half-hours (30-min)'}</div>
        <div className="detail">
          {context.alignment.id === 'native' ? ':00 half-hours only; WINDFOR is hourly' : ':30 values linearly interpolated'}
        </div>
      </div>
      <div>
        <div className="label">Data matched</div>
        <div className="value">
          {fmtInt(coverage.matched)} / {fmtInt(coverage.evaluated_intervals)} ({fmtPct((coverage.match_rate ?? 0) * 100, 1)})
        </div>
        <div className="detail">forecast + actual pairs used in every metric</div>
      </div>
    </section>
  )
}

const DEF = {
  actual: 'Mean of FUELHH half-hour average wind generation over the matched intervals (MW).',
  forecast: 'Mean of the selected day-ahead WINDFOR forecast over the same matched intervals (MW).',
  mae: 'Mean Absolute Error = mean(|forecast − actual|) over matched intervals.',
  rmse: 'Root Mean Squared Error = √mean((forecast − actual)²). Penalises large misses more than MAE.',
  bias: 'Mean of (forecast − actual). Positive = overforecasting, negative = underforecasting.',
  nmae: 'Normalised MAE = 100 × MAE ÷ mean actual. Not shown when mean actual is below 100 MW.',
  n: 'Number of intervals with both a valid eligible forecast and a valid actual.',
}

export function MetricKpis({ metrics, coverage, compact = false }: { metrics: Metrics; coverage: Coverage; compact?: boolean }) {
  const biasDir = metrics.bias_mw === null ? '' : metrics.bias_mw > 0 ? 'Overforecast on average' : 'Underforecast on average'
  return (
    <div className="grid grid-kpi">
      <KpiCard
        label="Actual generation"
        value={fmtMW(metrics.mean_actual_mw, false)}
        unit="MW avg"
        swatch="var(--series-actual)"
        hint={`${fmtGW(metrics.mean_actual_mw)} mean over matched intervals`}
        title={DEF.actual}
      />
      <KpiCard
        label="Day-ahead forecast"
        value={fmtMW(metrics.mean_forecast_mw, false)}
        unit="MW avg"
        swatch="var(--series-forecast)"
        hint="Same matched intervals"
        title={DEF.forecast}
      />
      <KpiCard label="MAE" value={fmtMW(metrics.mae_mw, false)} unit="MW" hint={`nMAE ${fmtPct(metrics.nmae_pct)} of mean actual`} title={DEF.mae} />
      <KpiCard label="RMSE" value={fmtMW(metrics.rmse_mw, false)} unit="MW" hint={`Largest miss ${fmtMW(metrics.max_abs_error_mw)}`} title={DEF.rmse} />
      <KpiCard label="Mean bias" value={fmtSignedMW(metrics.bias_mw, false)} unit="MW" hint={biasDir} title={DEF.bias} />
      {!compact && (
        <KpiCard
          label="Matched intervals"
          value={fmtInt(coverage.matched)}
          hint={`${fmtPct((coverage.match_rate ?? 0) * 100)} of ${fmtInt(coverage.evaluated_intervals)} evaluated`}
          title={DEF.n}
        />
      )}
    </div>
  )
}

export function SourceFreshness({ sources }: { sources: SourceInfo[] }) {
  const stale = sources.some((s) => s.stale)
  return (
    <span className="row" style={{ gap: 6 }}>
      <Icon name="refresh" size={12} />
      {sources.map((s) => `${s.dataset} retrieved ${fmtDateTime(s.fetched_at)}`).join(' · ')}
      {stale && ' · serving cached copy (refresh failed)'}
    </span>
  )
}

export function UnmatchedNotice({ coverage }: { coverage: Coverage }) {
  const unmatched = coverage.evaluated_intervals - coverage.matched
  if (unmatched <= 0) return null
  return (
    <Notice tone="warn">
      {fmtInt(unmatched)} evaluated interval{unmatched === 1 ? '' : 's'} could not be matched and {unmatched === 1 ? 'is' : 'are'} excluded
      from all metrics: {coverage.missing_actual} missing actual, {coverage.missing_forecast} without an eligible forecast,{' '}
      {coverage.missing_both} missing both.
    </Notice>
  )
}
