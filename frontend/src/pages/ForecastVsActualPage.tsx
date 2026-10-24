import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Interval } from '../api/types'
import { AsyncView, MetricKpis, SourceFreshness, UnmatchedNotice } from '../components/analysis'
import { ForecastActualChart } from '../components/charts/ForecastActualChart'
import { DataTable, type Column } from '../components/ui/DataTable'
import { Icon } from '../components/ui/Icon'
import { Badge, Card, EmptyState, Segmented, SkeletonKpis } from '../components/ui/primitives'
import { useMeta } from '../hooks/meta'
import { useAnalysisParams } from '../hooks/useAnalysisParams'
import { useApi } from '../hooks/useApi'
import { STATUS_LABEL, addDays, daysBetween, fmtDate, fmtDateTime, fmtHours, fmtMW, fmtSignedMW } from '../lib/format'

const COLUMNS: Column<Interval>[] = [
  { key: 't', header: 'Delivery (UK)', render: (i) => fmtDateTime(i.start_time), sortValue: (i) => i.start_time },
  { key: 'sp', header: 'SP', render: (i) => i.settlement_period, numeric: true, title: 'Settlement period' },
  { key: 'a', header: 'Actual', render: (i) => fmtMW(i.actual_mw), sortValue: (i) => i.actual_mw, numeric: true },
  {
    key: 'f',
    header: 'Forecast',
    render: (i) => (
      <>
        {fmtMW(i.forecast_mw)}
        {i.forecast_kind === 'interpolated' && <span className="muted"> ⁱ</span>}
      </>
    ),
    sortValue: (i) => i.forecast_mw,
    numeric: true,
  },
  { key: 'e', header: 'Error F−A', render: (i) => fmtSignedMW(i.error_mw), sortValue: (i) => i.error_mw, numeric: true },
  {
    key: 'abs',
    header: '|Error|',
    render: (i) => fmtMW(i.error_mw === null ? null : Math.abs(i.error_mw)),
    sortValue: (i) => (i.error_mw === null ? null : Math.abs(i.error_mw)),
    numeric: true,
  },
  {
    key: 'p',
    header: 'Forecast published',
    render: (i) => (i.forecast_publish_time ? fmtDateTime(i.forecast_publish_time) : '—'),
    sortValue: (i) => i.forecast_publish_time,
  },
  { key: 'h', header: 'Lead', render: (i) => fmtHours(i.horizon_hours), sortValue: (i) => i.horizon_hours, numeric: true },
  {
    key: 's',
    header: 'Status',
    render: (i) =>
      i.status === 'matched' ? (
        <Badge tone="soft" icon="check">
          Matched
        </Badge>
      ) : i.status === 'not_evaluated' ? (
        <Badge>{STATUS_LABEL[i.status]}</Badge>
      ) : (
        <Badge tone="warn" icon="alert">
          {STATUS_LABEL[i.status]}
        </Badge>
      ),
    sortValue: (i) => i.status,
  },
]

type StatusFilter = 'all' | 'matched' | 'unmatched'

export default function ForecastVsActualPage() {
  const meta = useMeta()
  const { query, queryKey, update } = useAnalysisParams()
  const state = useApi(`series|${queryKey}`, (signal) => api.series(query, signal))
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const singleDay = query.start === query.end
  const spanDays = daysBetween(query.start, query.end) + 1

  const inspect = (day: string) => update({ start: day, end: day })
  const step = (n: number) => {
    const d = addDays(query.start, n)
    if (d >= meta.delivery_date_first && d <= meta.delivery_date_last) inspect(d)
  }

  const tableRows = useMemo(() => {
    const rows = state.data?.intervals ?? []
    const evaluated = rows.filter((r) => r.status !== 'not_evaluated')
    if (statusFilter === 'matched') return evaluated.filter((r) => r.status === 'matched')
    if (statusFilter === 'unmatched') return evaluated.filter((r) => r.status !== 'matched')
    return rows
  }, [state.data, statusFilter])

  return (
    <>
      <div className="card" style={{ padding: '12px 16px' }}>
        <div className="row" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="inspect-day">Inspect a delivery day</label>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn icon-btn"
                aria-label="Previous day"
                onClick={() => step(-1)}
                disabled={!singleDay || query.start <= meta.delivery_date_first}
              >
                <Icon name="chevronLeft" />
              </button>
              <input
                id="inspect-day"
                className="input"
                type="date"
                min={meta.delivery_date_first}
                max={meta.delivery_date_last}
                value={singleDay ? query.start : ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v && v >= meta.delivery_date_first && v <= meta.delivery_date_last) inspect(v)
                }}
              />
              <button
                type="button"
                className="btn icon-btn"
                aria-label="Next day"
                onClick={() => step(1)}
                disabled={!singleDay || query.start >= meta.delivery_date_last}
              >
                <Icon name="chevronRight" />
              </button>
            </div>
          </div>
          <p className="text-2" style={{ flex: '1 1 300px', fontSize: 13 }}>
            {singleDay ? (
              <>
                Showing {fmtDate(query.start, true)}. The forecast was the latest WINDFOR publication before{' '}
                <strong>{fmtDate(addDays(query.start, -1))}</strong> at the cutoff.{' '}
                <Link to={`/publications?date=${query.start}${query.cutoff !== meta.default_cutoff ? `&cutoff=${query.cutoff}` : ''}`}>
                  See every publication for this day →
                </Link>
              </>
            ) : (
              <>Showing {spanDays} delivery days at 30-minute resolution. Pick a day to zoom in, or use the date range above.</>
            )}
          </p>
          {singleDay && (
            <button type="button" className="btn" onClick={() => update({ start: undefined, end: undefined })}>
              Back to full period
            </button>
          )}
        </div>
      </div>
      <AsyncView state={state} loading={<SkeletonKpis count={5} />}>
        {(d) => (
          <>
            <MetricKpis metrics={d.metrics} coverage={d.coverage} />
            <UnmatchedNotice coverage={d.coverage} />
            <Card
              title="Actual vs selected day-ahead forecast"
              subtitle={
                d.context.alignment.id === 'native'
                  ? 'Actual at 30-minute resolution; WINDFOR forecast points are hourly. Gaps mean no valid value.'
                  : 'All half-hours; :30 forecast values are interpolated from the selected publication’s hourly points.'
              }
              actions={
                <Segmented
                  label="View"
                  value={view}
                  options={[
                    { value: 'chart', label: 'Chart' },
                    { value: 'table', label: 'Table' },
                  ]}
                  onChange={setView}
                />
              }
              footer={<SourceFreshness sources={d.context.sources} />}
            >
              <div className="chart-legend" style={{ marginBottom: 8 }}>
                <span>
                  <span className="swatch-line" style={{ background: 'var(--series-actual)' }} /> Actual (FUELHH, MW)
                </span>
                <span>
                  <span className="swatch-line" style={{ background: 'var(--series-forecast)' }} /> Day-ahead forecast (WINDFOR, MW)
                </span>
                <span>
                  <span className="swatch" style={{ background: 'var(--over)' }} /> Overforecast
                </span>
                <span>
                  <span className="swatch" style={{ background: 'var(--under)' }} /> Underforecast
                </span>
              </div>
              {d.intervals.length === 0 ? (
                <EmptyState title="No intervals in this range" />
              ) : view === 'chart' ? (
                <ForecastActualChart intervals={d.intervals} spanDays={spanDays} />
              ) : (
                <>
                  <div className="row" style={{ marginBottom: 10 }}>
                    <Segmented<StatusFilter>
                      label="Filter rows by status"
                      value={statusFilter}
                      options={[
                        { value: 'all', label: 'All half-hours' },
                        { value: 'matched', label: 'Matched' },
                        { value: 'unmatched', label: 'Unmatched' },
                      ]}
                      onChange={setStatusFilter}
                    />
                    {d.context.alignment.id === 'interpolated' && <span className="muted">ⁱ interpolated value</span>}
                  </div>
                  <DataTable
                    key={`${queryKey}|${statusFilter}`}
                    rows={tableRows}
                    columns={COLUMNS}
                    rowKey={(i) => i.start_time}
                    initialSort={{ key: 't', dir: 'asc' }}
                    pageSize={48}
                    caption="Delivery intervals with actual and selected forecast generation"
                    emptyMessage={statusFilter === 'unmatched' ? 'Every evaluated interval was matched.' : undefined}
                    onRowClick={singleDay ? undefined : (i) => inspect(i.delivery_date)}
                  />
                </>
              )}
            </Card>
            {!singleDay && (
              <Card title="Days in range" subtitle="Select a day to inspect its 30-minute detail.">
                <div className="row" style={{ gap: 6 }}>
                  {Array.from(new Set(d.intervals.map((i) => i.delivery_date))).map((day) => (
                    <button key={day} type="button" className="btn" onClick={() => inspect(day)}>
                      {fmtDate(day)}
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </AsyncView>
    </>
  )
}
