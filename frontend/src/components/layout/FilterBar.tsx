import { useEffect, useState } from 'react'
import type { AlignmentId, CutoffId } from '../../api/types'
import { useMeta } from '../../hooks/meta'
import { useAnalysisParams } from '../../hooks/useAnalysisParams'
import { addDays, fmtDate } from '../../lib/format'
import { Segmented } from '../ui/primitives'

export type FilterKey = 'range' | 'cutoff' | 'alignment'

/** One filter row that scopes every chart on the page. State is stored in the URL. */
export function FilterBar({ show }: { show: FilterKey[] }) {
  const meta = useMeta()
  const { query, update } = useAnalysisParams()
  const first = meta.delivery_date_first
  const last = meta.delivery_date_last

  // Draft values let the user type freely; only valid ranges are committed.
  const [draft, setDraft] = useState({ start: query.start, end: query.end })
  useEffect(() => setDraft({ start: query.start, end: query.end }), [query.start, query.end])

  const error =
    !draft.start || !draft.end
      ? 'Enter both dates.'
      : draft.start < first || draft.end > last || draft.start > last || draft.end < first
        ? `Dates must be between ${fmtDate(first)} and ${fmtDate(last)}.`
        : draft.start > draft.end
          ? 'Start must be on or before end.'
          : null

  const commit = (next: { start: string; end: string }) => {
    setDraft(next)
    const valid = next.start && next.end && next.start >= first && next.end <= last && next.start <= next.end
    if (valid) update({ start: next.start, end: next.end })
  }

  const presets = [
    { label: 'Full period', start: first, end: last },
    { label: 'First half', start: first, end: addDays(first, 14) },
    { label: 'Second half', start: addDays(first, 15), end: last },
    { label: 'Last 7 days', start: addDays(last, -6), end: last },
  ]
  const activePreset = presets.find((p) => p.start === query.start && p.end === query.end)?.label ?? ''

  return (
    <div className="filters" role="search" aria-label="Analysis filters">
      {show.includes('range') && (
        <>
          <div className="field">
            <span className="field-label" id="range-label">
              Delivery dates (UK)
            </span>
            <div className="date-range" role="group" aria-labelledby="range-label">
              <input
                className="input"
                type="date"
                aria-label="Start delivery date"
                min={first}
                max={last}
                value={draft.start}
                aria-invalid={!!error}
                onChange={(e) => commit({ ...draft, start: e.target.value })}
              />
              <span className="muted">to</span>
              <input
                className="input"
                type="date"
                aria-label="End delivery date"
                min={first}
                max={last}
                value={draft.end}
                aria-invalid={!!error}
                onChange={(e) => commit({ ...draft, end: e.target.value })}
              />
            </div>
            {error && (
              <span className="field-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <div className="field">
            <span className="field-label">Range</span>
            <Segmented
              label="Date range presets"
              value={activePreset}
              options={presets.map((p) => ({ value: p.label, label: p.label, title: `${fmtDate(p.start)} – ${fmtDate(p.end)}` }))}
              onChange={(label) => {
                const p = presets.find((x) => x.label === label)!
                commit({ start: p.start, end: p.end })
              }}
            />
          </div>
        </>
      )}
      {show.includes('cutoff') && (
        <div className="field">
          <span className="field-label">Decision cutoff (D-1)</span>
          <Segmented<CutoffId>
            label="Decision cutoff policy"
            value={query.cutoff}
            options={meta.cutoff_policies.map((p) => ({
              value: p.id,
              label: `${p.id === 'n2ex' ? 'N2EX' : 'EPEX'} ${p.local_time}`,
              title: p.label,
            }))}
            onChange={(cutoff) => update({ cutoff })}
          />
        </div>
      )}
      {show.includes('alignment') && (
        <div className="field">
          <span className="field-label">Interval alignment</span>
          <Segmented<AlignmentId>
            label="Half-hour alignment"
            value={query.alignment}
            options={[
              { value: 'native', label: 'Hourly (published)', title: meta.alignments.find((a) => a.id === 'native')?.description },
              {
                value: 'interpolated',
                label: '30-min (interpolated)',
                title: meta.alignments.find((a) => a.id === 'interpolated')?.description,
              },
            ]}
            onChange={(alignment) => update({ alignment })}
          />
        </div>
      )}
    </div>
  )
}
