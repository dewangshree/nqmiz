import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AnalysisQuery } from '../api/client'
import type { AlignmentId, CutoffId } from '../api/types'
import { useMeta } from './meta'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Global analysis filters live in the URL so every page shares the same slice,
 * links are shareable and browser back/forward restores the previous view.
 * Invalid or out-of-period values fall back to the defaults.
 */
export function useAnalysisParams() {
  const meta = useMeta()
  const [params, setParams] = useSearchParams()

  const query: AnalysisQuery = useMemo(() => {
    const first = meta.delivery_date_first
    const last = meta.delivery_date_last
    const inPeriod = (v: string | null) => (v && ISO_DATE.test(v) && v >= first && v <= last ? v : null)
    let start = inPeriod(params.get('start')) ?? first
    let end = inPeriod(params.get('end')) ?? last
    if (start > end) [start, end] = [first, last]
    const cutoffParam = params.get('cutoff')
    const cutoff = (meta.cutoff_policies.some((p) => p.id === cutoffParam) ? cutoffParam : meta.default_cutoff) as CutoffId
    const alignParam = params.get('alignment')
    const alignment = (meta.alignments.some((a) => a.id === alignParam) ? alignParam : meta.default_alignment) as AlignmentId
    return { start, end, cutoff, alignment }
  }, [params, meta])

  const update = useCallback(
    (patch: Partial<AnalysisQuery> & Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') next.delete(k)
            else next.set(k, v)
          }
          // Keep URLs tidy: drop values equal to the defaults.
          if (next.get('start') === meta.delivery_date_first) next.delete('start')
          if (next.get('end') === meta.delivery_date_last) next.delete('end')
          if (next.get('cutoff') === meta.default_cutoff) next.delete('cutoff')
          if (next.get('alignment') === meta.default_alignment) next.delete('alignment')
          return next
        },
        { replace: false },
      )
    },
    [setParams, meta],
  )

  const queryKey = `${query.start}|${query.end}|${query.cutoff}|${query.alignment}`
  return { query, queryKey, update, params }
}
