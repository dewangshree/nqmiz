// Typed mirrors of the FastAPI response models (backend/app/schemas.py).
// All timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD UK settlement dates.

export type CutoffId = 'n2ex' | 'epex'
export type AlignmentId = 'native' | 'interpolated'
export type IntervalStatus = 'matched' | 'missing_actual' | 'missing_forecast' | 'missing_both' | 'not_evaluated'

export interface Metrics {
  n: number
  mean_actual_mw: number | null
  mean_forecast_mw: number | null
  mae_mw: number | null
  rmse_mw: number | null
  bias_mw: number | null
  nmae_pct: number | null
  max_abs_error_mw: number | null
  p10_error_mw: number | null
  p50_error_mw: number | null
  p90_error_mw: number | null
  over_count: number
  under_count: number
  exact_count: number
}

export interface Coverage {
  delivery_days: number
  total_half_hours: number
  evaluated_intervals: number
  matched: number
  missing_actual: number
  missing_forecast: number
  missing_both: number
  match_rate: number | null
  actual_half_hours_available: number
  actual_energy_gwh: number | null
}

export interface CutoffPolicy {
  id: CutoffId
  label: string
  local_time: string
  rationale: string
  source_url: string
}

export interface Alignment {
  id: AlignmentId
  description: string
}

export interface SourceInfo {
  dataset: string
  endpoint: string
  params: Record<string, string>
  fetched_at: string
  from_cache: boolean
  stale: boolean
  rows_received: number
}

export interface Context {
  start: string
  end: string
  cutoff: CutoffPolicy
  alignment: Alignment
  sources: SourceInfo[]
}

export interface Daily {
  delivery_date: string
  decision_date: string
  cutoff_utc: string
  selected_publications: string[]
  metrics: Metrics
  coverage: Coverage
}

export interface OverviewResponse {
  context: Context
  metrics: Metrics
  coverage: Coverage
  daily: Daily[]
  insights: string[]
}

export interface Interval {
  start_time: string
  delivery_date: string
  settlement_period: number
  cutoff_utc: string
  actual_mw: number | null
  forecast_mw: number | null
  forecast_kind: 'published' | 'interpolated' | null
  forecast_publish_time: string | null
  horizon_hours: number | null
  error_mw: number | null
  status: IntervalStatus
}

export interface SeriesResponse {
  context: Context
  metrics: Metrics
  coverage: Coverage
  intervals: Interval[]
}

export interface AccuracyResponse {
  context: Context
  metrics: Metrics
  coverage: Coverage
  daily: Daily[]
  by_hour: { hour_local: number; metrics: Metrics }[]
  by_horizon: { label: string; min_hours: number; max_hours: number | null; metrics: Metrics }[]
  error_histogram: { bin_start: number; bin_end: number; count: number }[]
  largest_errors: Interval[]
  benchmark: { description: string; day_ahead: Metrics; latest_before_delivery: Metrics }
}

export interface PublicationRow {
  publish_time: string
  start_time: string
  forecast_mw: number
  eligible: boolean
  selected: boolean
  horizon_hours: number
  actual_mw: number | null
  error_mw: number | null
}

export interface PublicationsResponse {
  delivery_date: string
  decision_date: string
  cutoff_utc: string
  cutoff: CutoffPolicy
  publication_count: number
  eligible_publication_count: number
  rows: PublicationRow[]
  actuals: { start_time: string; actual_mw: number | null }[]
  sources: SourceInfo[]
}

export interface Quality {
  received: number
  accepted: number
  rejected: Record<string, number>
  duplicates_removed: number
  conflicting_duplicates: number
}

export interface MetaResponse {
  decision_date_first: string
  decision_date_last: string
  delivery_date_first: string
  delivery_date_last: string
  timezone: string
  cutoff_policies: CutoffPolicy[]
  default_cutoff: CutoffId
  alignments: Alignment[]
  default_alignment: AlignmentId
  sources: SourceInfo[]
  actual_quality: Quality
  forecast_quality: Quality
  forecast_publication_count: number
  forecast_publication_times_local: string[]
  forecast_point_spacing_minutes: number[]
}
