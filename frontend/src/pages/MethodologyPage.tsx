import { useState } from 'react'
import { api } from '../api/client'
import type { Quality } from '../api/types'
import { Icon } from '../components/ui/Icon'
import { Card, Notice } from '../components/ui/primitives'
import { useMeta, useMetaState } from '../hooks/meta'
import { fmtDate, fmtDateTime, fmtInt } from '../lib/format'

function QualityList({ q }: { q: Quality }) {
  const rejected = Object.entries(q.rejected)
  return (
    <dl className="kv">
      <dt>Rows received</dt>
      <dd className="tabular">{fmtInt(q.received)}</dd>
      <dt>Rows accepted</dt>
      <dd className="tabular">{fmtInt(q.accepted)}</dd>
      <dt>Rejected</dt>
      <dd>{rejected.length ? rejected.map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ') : 'None'}</dd>
      <dt>Duplicates removed</dt>
      <dd className="tabular">
        {fmtInt(q.duplicates_removed)} ({q.conflicting_duplicates} with conflicting values)
      </dd>
    </dl>
  )
}

/** Simple decision timeline: D-1 publications, cutoff, delivery day D. */
function Timeline({ cutoffs, pubTimes }: { cutoffs: { label: string; time: string }[]; pubTimes: string[] }) {
  // Map D-1 00:00 .. D+1 00:00 (48 h) onto 0..100%.
  const pos = (h: number) => `${(h / 48) * 100}%`
  const toH = (t: string) => Number(t.slice(0, 2)) + Number(t.slice(3, 5)) / 60
  return (
    <div style={{ position: 'relative', height: 108, margin: '8px 4px 0' }} aria-hidden>
      <div style={{ position: 'absolute', top: 48, left: 0, right: 0, height: 2, background: 'var(--axis)' }} />
      <div
        style={{
          position: 'absolute',
          top: 40,
          left: pos(24),
          right: 0,
          height: 18,
          background: 'var(--accent-soft)',
          border: '1px solid var(--accent)',
          borderRadius: 4,
        }}
      />
      <div style={{ position: 'absolute', top: 62, left: pos(24), fontSize: 12, color: 'var(--accent)', fontWeight: 600, paddingLeft: 6 }}>
        Delivery day D (00:00–24:00 UK)
      </div>
      {pubTimes.map((t) => (
        <div
          key={t}
          title={`WINDFOR publication ${t} UK`}
          style={{
            position: 'absolute',
            top: 43,
            left: pos(toH(t)),
            width: 6,
            height: 12,
            marginLeft: -3,
            borderRadius: 2,
            background: 'var(--series-forecast)',
          }}
        />
      ))}
      {cutoffs.map((c, i) => (
        <div key={c.label} style={{ position: 'absolute', top: i ? 0 : 14, left: pos(toH(c.time)) }}>
          <div style={{ position: 'absolute', top: 0, height: 70 - (i ? 0 : 14), borderLeft: `2px solid ${i ? 'var(--muted)' : 'var(--text)'}` }} />
          <div style={{ fontSize: 11.5, whiteSpace: 'nowrap', paddingLeft: 6, color: i ? 'var(--muted)' : 'var(--text)', fontWeight: 600 }}>
            {c.label} {c.time}
          </div>
        </div>
      ))}
      {[0, 12, 24, 36, 48].map((h) => (
        <div key={h} style={{ position: 'absolute', top: 86, left: pos(h), fontSize: 11, color: 'var(--muted)', transform: h === 48 ? 'translateX(-100%)' : h ? 'translateX(-50%)' : undefined }}>
          {h < 24 ? `D-1 ${String(h).padStart(2, '0')}:00` : h < 48 ? `D ${String(h - 24).padStart(2, '0')}:00` : 'D+1 00:00'}
        </div>
      ))}
    </div>
  )
}

export default function MethodologyPage() {
  const meta = useMeta()
  const { reload } = useMetaState()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const m = await api.refresh()
      const stale = m.sources.some((s) => s.stale)
      setRefreshMsg(
        stale
          ? { tone: 'error', text: 'Elexon could not be reached; the previously cached copy is still being served.' }
          : { tone: 'info', text: 'Source data re-downloaded from Elexon. All views now use the refreshed copy.' },
      )
      reload()
    } catch (err) {
      setRefreshMsg({ tone: 'error', text: (err as Error).message })
    } finally {
      setRefreshing(false)
    }
  }

  const REGULAR = ['02:30', '04:30', '07:30', '09:30', '11:30', '15:30', '18:30', '22:30']
  const irregular = meta.forecast_publication_times_local.filter((t) => !REGULAR.includes(t))
  const n2ex = meta.cutoff_policies.find((p) => p.id === 'n2ex')!
  const epex = meta.cutoff_policies.find((p) => p.id === 'epex')!

  return (
    <>
      <div className="grid grid-2">
        <Card title="Analysis period">
          <div className="prose">
            <p>
              The assignment concerns <strong>purchasing decisions made in January 2026</strong>. A day-ahead decision on day D-1 buys
              electricity for delivery day D, so:
            </p>
            <dl className="kv">
              <dt>Decision dates</dt>
              <dd>
                {fmtDate(meta.decision_date_first, true)} – {fmtDate(meta.decision_date_last, true)}
              </dd>
              <dt>Delivery dates</dt>
              <dd>
                {fmtDate(meta.delivery_date_first, true)} – {fmtDate(meta.delivery_date_last, true)}
              </dd>
              <dt>Delivery day</dt>
              <dd>UK settlement date, 00:00–24:00 Europe/London (48 half-hours; 46/50 on clock-change days)</dd>
              <dt>Time zone</dt>
              <dd>All times shown in UK local time. In January UK time equals UTC (GMT).</dd>
            </dl>
            <p>
              <strong>Boundary cases:</strong> delivery on 1 January 2026 is excluded because its decision was made on 31 December 2025.
              Delivery on 1 February 2026 is included because its decision was made on 31 January 2026.
            </p>
          </div>
        </Card>
        <Card title="Elexon data sources">
          <div className="prose">
            <p>
              <strong>Actual generation — FUELHH</strong> (<code>/datasets/FUELHH/stream</code>), filtered to <code>fuelType = WIND</code>{' '}
              by settlement date. <code>generation</code> is the average MW over each 30-minute interval starting at{' '}
              <code>startTime</code>.
            </p>
            <p>
              <strong>Forecasts — WINDFOR</strong> (<code>/datasets/WINDFOR/stream</code>), filtered by <code>publishTime</code>. Observed in
              the retrieved data: {fmtInt(meta.forecast_publication_count)} publications at{' '}
              {meta.forecast_publication_times_local.join(', ')} UK, each with forecast points spaced{' '}
              {meta.forecast_point_spacing_minutes.join('/')} minutes apart.
            </p>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Both endpoints were verified with live requests: they return bare JSON arrays, UTC timestamps with a <code>Z</code> suffix,
              and do not paginate. FUELHH settlement-date and publish-time filters cannot be combined.
            </p>
            <div className="row">
              <a className="btn" href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream" target="_blank" rel="noreferrer">
                FUELHH docs <Icon name="external" size={12} />
              </a>
              <a className="btn" href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream" target="_blank" rel="noreferrer">
                WINDFOR docs <Icon name="external" size={12} />
              </a>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Forecast-selection policy and decision cutoff" subtitle="The core of the evaluation: which forecast could the buyer actually have used?">
        <Timeline
          cutoffs={[
            { label: 'N2EX cutoff', time: n2ex.local_time },
            { label: 'EPEX cutoff', time: epex.local_time },
          ]}
          pubTimes={meta.forecast_publication_times_local.filter((t) => REGULAR.includes(t))}
        />
        <div className="prose" style={{ marginTop: 12 }}>
          <p>For every delivery interval in day D:</p>
          <ul>
            <li>Compute the decision cutoff: the gate-closure time on D-1, UK local time.</li>
            <li>
              Keep only WINDFOR publications whose <code>publishTime</code> is <strong>strictly before</strong> the cutoff.
            </li>
            <li>Select the latest of those that contains a forecast point for the interval.</li>
            <li>Pair it with the FUELHH actual for the same <code>startTime</code>. Compute errors only when both exist.</li>
            <li>Publications at or after the cutoff are never selected, so the evaluation has no look-ahead bias.</li>
          </ul>
          <p>
            <strong>Default cutoff — {n2ex.label}.</strong> {n2ex.rationale}{' '}
            <a href={n2ex.source_url} target="_blank" rel="noreferrer">
              Nord Pool source
            </a>
          </p>
          <p>
            <strong>Alternative — {epex.label}.</strong> {epex.rationale} Switch between them with the cutoff control on any analysis page.
          </p>
          <p>
            <strong>Hourly forecasts vs half-hourly actuals.</strong> WINDFOR publishes hourly points. By default only half-hours starting
            on the hour are evaluated (no derived values). The optional 30-minute mode linearly interpolates :30 values between two
            hourly points of the same selected publication; those values are marked as interpolated.
          </p>
        </div>
      </Card>

      <Card title="Metric definitions" subtitle="All metrics use the same set of matched forecast/actual pairs. Error = forecast − actual.">
        <div className="grid grid-2">
          <div className="prose">
            <p>
              <strong>MAE</strong> — average size of the miss, in MW.
            </p>
            <div className="formula">MAE = mean(|forecast − actual|)</div>
            <p>
              <strong>RMSE</strong> — like MAE but weights large misses more heavily.
            </p>
            <div className="formula">RMSE = √ mean((forecast − actual)²)</div>
            <p>
              <strong>Mean bias</strong> — positive means overforecasting, negative underforecasting.
            </p>
            <div className="formula">Bias = mean(forecast − actual)</div>
          </div>
          <div className="prose">
            <p>
              <strong>nMAE</strong> — MAE relative to mean actual generation. Not reported when mean actual is below 100 MW, to avoid
              misleading percentages near zero output. No per-interval percentage error is used.
            </p>
            <div className="formula">nMAE = 100 × MAE ÷ mean(actual)</div>
            <p>
              <strong>Units.</strong> Generation values are average MW over each interval. KPI “actual generation” is the mean MW across
              matched intervals. Energy (GWh) is only derived from FUELHH as Σ MW × 0.5 h; forecast MW are never summed into energy.
            </p>
            <p>
              <strong>Match rate</strong> = matched intervals ÷ evaluated intervals. Unmatched intervals are listed by reason and excluded
              from every metric; missing values are never treated as zero.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Data quality — FUELHH (actuals)">
          <QualityList q={meta.actual_quality} />
        </Card>
        <Card title="Data quality — WINDFOR (forecasts)">
          <QualityList q={meta.forecast_quality} />
        </Card>
      </div>

      <Card
        title="Source freshness"
        subtitle="Raw Elexon responses are cached on the backend (memory + disk) and re-used for every filter change."
        actions={
          <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
            <Icon name="refresh" size={14} />
            {refreshing ? 'Refreshing…' : 'Re-download from Elexon'}
          </button>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">Source data retrieval</caption>
            <thead>
              <tr>
                <th scope="col">Dataset</th>
                <th scope="col">Endpoint</th>
                <th scope="col">Query</th>
                <th scope="col">Retrieved (UK)</th>
                <th scope="col" className="num">
                  Rows
                </th>
                <th scope="col">Cache</th>
              </tr>
            </thead>
            <tbody>
              {meta.sources.map((s) => (
                <tr key={s.dataset}>
                  <td>{s.dataset}</td>
                  <td className="mono">{s.endpoint}</td>
                  <td className="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all', minWidth: 220 }}>
                    {Object.entries(s.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' & ')}
                  </td>
                  <td>{fmtDateTime(s.fetched_at)}</td>
                  <td className="num">{fmtInt(s.rows_received)}</td>
                  <td>{s.stale ? 'Stale copy (refresh failed)' : s.from_cache ? 'From cache' : 'Fresh download'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {refreshMsg && (
          <div style={{ marginTop: 12 }}>
            <Notice tone={refreshMsg.tone === 'error' ? 'error' : 'info'}>{refreshMsg.text}</Notice>
          </div>
        )}
      </Card>

      <Card title="Known limitations" subtitle="Read these before drawing procurement conclusions.">
        <div className="prose">
          <ul>
            <li>
              <strong>Scope.</strong> Only national wind actuals (FUELHH) and forecasts (WINDFOR) are used. Without demand, price or other
              generation data, forecast error is a measure of wind uncertainty, not of a procurement shortfall or cost.
            </li>
            <li>
              <strong>Different coverage of forecast and actual.</strong> WINDFOR covers wind farms visible to the system operator with
              operational metering; FUELHH reports metered transmission-level output, which reflects curtailment and balancing actions.
              Part of any persistent bias may come from these definitional differences rather than forecast skill. This is not
              separable with these two datasets alone.
            </li>
            <li>
              <strong>Hourly forecast resolution.</strong> WINDFOR points are hourly, so the default evaluation covers 24 of 48 half-hours per
              day. The 30-minute mode relies on interpolated values that Elexon did not publish.
            </li>
            <li>
              <strong>Cutoff assumption.</strong> Gate-closure times come from exchange documentation (N2EX 09:50, EPEX 09:20 UK). A real
              trading desk may finalise bids earlier, and the exchanges’ delivery-day definitions may differ from the UK settlement day
              used here. The cutoff is configurable for this reason.
            </li>
            <li>
              <strong>Availability equals <code>publishTime</code>.</strong> A forecast is assumed to be usable from its{' '}
              <code>publishTime</code>; any dissemination delay is not modelled.
            </li>
            <li>
              <strong>Data retrieved after the fact.</strong> Data were downloaded on {fmtDateTime(meta.sources[0]?.fetched_at ?? new Date().toISOString())}
              . Forecast vintages are reconstructed exactly from their publish times; FUELHH values are the current published values and
              may include later revisions.
            </li>
            <li>
              <strong>Publication history excludes back-dated points.</strong> WINDFOR publications also contain points for times before
              their publish time; those are not forecasts and are not shown or used.
            </li>
            {irregular.length > 0 && (
              <li>
                <strong>Irregular publication times.</strong> Publications were also observed at {irregular.join(', ')} UK, outside the
                usual schedule. They are handled exactly like any other publication: eligible only if issued before the cutoff.
              </li>
            )}
          </ul>
        </div>
      </Card>
    </>
  )
}
