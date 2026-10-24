import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { PublicationRow } from '../api/types'
import { AsyncView, SourceFreshness } from '../components/analysis'
import { DayCurvesChart, IntervalEvolutionChart } from '../components/charts/PublicationCharts'
import { DataTable, type Column } from '../components/ui/DataTable'
import { Icon } from '../components/ui/Icon'
import { Badge, Card, EmptyState, Notice, Segmented } from '../components/ui/primitives'
import { useMeta } from '../hooks/meta'
import { useAnalysisParams } from '../hooks/useAnalysisParams'
import { useApi } from '../hooks/useApi'
import { addDays, fmtDate, fmtDateTime, fmtHours, fmtMW, fmtSignedMW, fmtTime } from '../lib/format'

type Eligibility = 'all' | 'eligible' | 'after'

const COLUMNS: Column<PublicationRow>[] = [
  { key: 'pub', header: 'Published (UK)', render: (r) => fmtDateTime(r.publish_time), sortValue: (r) => r.publish_time },
  { key: 'del', header: 'Delivery (UK)', render: (r) => fmtDateTime(r.start_time), sortValue: (r) => r.start_time },
  { key: 'f', header: 'Forecast', render: (r) => fmtMW(r.forecast_mw), sortValue: (r) => r.forecast_mw, numeric: true },
  { key: 'h', header: 'Lead', render: (r) => fmtHours(r.horizon_hours), sortValue: (r) => r.horizon_hours, numeric: true },
  {
    key: 'el',
    header: 'At cutoff',
    render: (r) =>
      r.eligible ? (
        <Badge tone="soft" icon="check" title="Published before the decision cutoff">
          Available
        </Badge>
      ) : (
        <Badge icon="lock" title="Published at or after the decision cutoff; could not inform the purchase">
          After cutoff
        </Badge>
      ),
    sortValue: (r) => (r.eligible ? 1 : 0),
  },
  {
    key: 'sel',
    header: 'Used for decision',
    render: (r) =>
      r.selected ? (
        <Badge tone="accent" icon="check">
          Selected
        </Badge>
      ) : (
        <span className="muted">—</span>
      ),
    sortValue: (r) => (r.selected ? 1 : 0),
  },
  { key: 'a', header: 'Actual', render: (r) => fmtMW(r.actual_mw), sortValue: (r) => r.actual_mw, numeric: true },
  { key: 'e', header: 'Error F−A', render: (r) => fmtSignedMW(r.error_mw), sortValue: (r) => r.error_mw, numeric: true },
]

export default function PublicationsPage() {
  const meta = useMeta()
  const { query, params, update } = useAnalysisParams()
  const rawDate = params.get('date')
  const date =
    rawDate && rawDate >= meta.delivery_date_first && rawDate <= meta.delivery_date_last ? rawDate : meta.delivery_date_first
  const interval = params.get('interval') ?? '' // ISO start time, '' = whole day
  const [eligibility, setEligibility] = useState<Eligibility>('all')
  const [selectedOnly, setSelectedOnly] = useState(false)

  const state = useApi(`pubs|${date}|${query.cutoff}`, (signal) => api.publications(date, query.cutoff, signal))
  const setDate = (d: string) => update({ date: d, interval: undefined })

  const data = state.data
  const intervalOptions = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.rows.map((r) => r.start_time))).sort()
  }, [data])
  const activeInterval = interval && intervalOptions.includes(interval) ? interval : ''

  const tableRows = useMemo(() => {
    let rows = data?.rows ?? []
    if (activeInterval) rows = rows.filter((r) => r.start_time === activeInterval)
    if (eligibility === 'eligible') rows = rows.filter((r) => r.eligible)
    if (eligibility === 'after') rows = rows.filter((r) => !r.eligible)
    if (selectedOnly) rows = rows.filter((r) => r.selected)
    return rows
  }, [data, activeInterval, eligibility, selectedOnly])

  const intervalRows = useMemo(
    () => (data && activeInterval ? data.rows.filter((r) => r.start_time === activeInterval) : []),
    [data, activeInterval],
  )
  const selectedPubs = useMemo(() => Array.from(new Set((data?.rows ?? []).filter((r) => r.selected).map((r) => r.publish_time))), [data])

  return (
    <>
      <div className="card" style={{ padding: '12px 16px' }}>
        <div className="filters">
          <div className="field">
            <label htmlFor="pub-date">Delivery day (UK)</label>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn icon-btn"
                aria-label="Previous day"
                disabled={date <= meta.delivery_date_first}
                onClick={() => setDate(addDays(date, -1))}
              >
                <Icon name="chevronLeft" />
              </button>
              <input
                id="pub-date"
                className="input"
                type="date"
                min={meta.delivery_date_first}
                max={meta.delivery_date_last}
                value={date}
                onChange={(e) => {
                  const v = e.target.value
                  if (v && v >= meta.delivery_date_first && v <= meta.delivery_date_last) setDate(v)
                }}
              />
              <button
                type="button"
                className="btn icon-btn"
                aria-label="Next day"
                disabled={date >= meta.delivery_date_last}
                onClick={() => setDate(addDays(date, 1))}
              >
                <Icon name="chevronRight" />
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="pub-interval">Delivery interval</label>
            <select
              id="pub-interval"
              className="select"
              value={activeInterval}
              onChange={(e) => update({ interval: e.target.value || undefined })}
              disabled={!intervalOptions.length}
            >
              <option value="">Whole day (all hourly points)</option>
              {intervalOptions.map((t) => (
                <option key={t} value={t}>
                  {fmtTime(t)} UK
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Publication status</span>
            <Segmented<Eligibility>
              label="Filter by availability at cutoff"
              value={eligibility}
              options={[
                { value: 'all', label: 'All' },
                { value: 'eligible', label: 'Available at cutoff' },
                { value: 'after', label: 'After cutoff' },
              ]}
              onChange={setEligibility}
            />
          </div>
          <label className="row" style={{ gap: 6, height: 32 }}>
            <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} />
            Selected forecasts only
          </label>
        </div>
      </div>

      <AsyncView state={state}>
        {(d) => (
          <>
            <section className="card banner" aria-label="Decision timeline">
              <div>
                <div className="label">Delivery day</div>
                <div className="value">{fmtDate(d.delivery_date, true)}</div>
                <div className="detail">00:00–24:00 UK settlement day</div>
              </div>
              <div>
                <div className="label">Decision cutoff</div>
                <div className="value">{fmtDateTime(d.cutoff_utc)} UK</div>
                <div className="detail">{d.cutoff.label}</div>
              </div>
              <div>
                <div className="label">Publications covering this day</div>
                <div className="value">
                  {d.publication_count} total · {d.eligible_publication_count} before cutoff
                </div>
                <div className="detail">{d.publication_count - d.eligible_publication_count} published after the decision</div>
              </div>
              <div>
                <div className="label">Forecast used for the decision</div>
                <div className="value">{selectedPubs.length ? selectedPubs.map(fmtDateTime).join(', ') : 'None eligible'}</div>
                <div className="detail">Latest publication strictly before the cutoff</div>
              </div>
            </section>
            <Notice>
              Rows marked <strong>After cutoff</strong> were published once the day-ahead auction had closed. They are shown so you can
              see how the forecast evolved, but they were never used in the accuracy evaluation.
            </Notice>
            {d.rows.length === 0 ? (
              <div className="card">
                <EmptyState title="No forecast publications cover this day">
                  WINDFOR returned no forecast points for this delivery day within the retrieved publication window.
                </EmptyState>
              </div>
            ) : (
              <>
                <Card
                  title={activeInterval ? `Forecast evolution for ${fmtTime(activeInterval)} UK` : 'Every forecast for this delivery day'}
                  subtitle={
                    activeInterval
                      ? 'Each point is one publication’s forecast for this interval. Points right of the cutoff line could not inform the purchase.'
                      : 'Each grey line is one publication. Choose a delivery interval above to see how its forecast moved over time.'
                  }
                >
                  {activeInterval ? (
                    <>
                      <div className="chart-legend" style={{ marginBottom: 8 }}>
                        <span>
                          <span className="swatch" style={{ background: 'var(--series-forecast)' }} /> Available at cutoff
                        </span>
                        <span>
                          <span className="swatch" style={{ background: 'var(--muted)' }} /> After cutoff
                        </span>
                        <span>◎ Selected</span>
                        <span>
                          <span className="swatch-line" style={{ background: 'var(--series-actual)' }} /> Actual
                        </span>
                        <span>
                          <span className="swatch-line" style={{ background: 'var(--accent)' }} /> Decision cutoff
                        </span>
                      </div>
                      <IntervalEvolutionChart
                        rows={intervalRows}
                        cutoffUtc={d.cutoff_utc}
                        actual={d.actuals.find((a) => a.start_time === activeInterval)?.actual_mw ?? null}
                      />
                    </>
                  ) : (
                    <DayCurvesChart rows={d.rows} actuals={d.actuals} />
                  )}
                </Card>
                <Card
                  title="Publication history"
                  subtitle={`${tableRows.length.toLocaleString('en-GB')} forecast points. Highlighted rows are the forecasts used for the day-ahead evaluation; select a row to focus its interval.`}
                  footer={<SourceFreshness sources={d.sources} />}
                >
                  <DataTable
                    key={`${date}|${query.cutoff}|${activeInterval}|${eligibility}|${selectedOnly}`}
                    rows={tableRows}
                    columns={COLUMNS}
                    rowKey={(r) => `${r.publish_time}|${r.start_time}`}
                    initialSort={{ key: 'del', dir: 'asc' }}
                    pageSize={24}
                    caption="Forecast publication history"
                    rowClassName={(r) => (r.selected ? 'row-selected' : !r.eligible ? 'row-ineligible' : undefined)}
                    onRowClick={(r) => update({ interval: r.start_time })}
                  />
                </Card>
              </>
            )}
          </>
        )}
      </AsyncView>
    </>
  )
}
