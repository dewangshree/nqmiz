import type {
  AccuracyResponse,
  AlignmentId,
  CutoffId,
  MetaResponse,
  OverviewResponse,
  PublicationsResponse,
  SeriesResponse,
} from './types'

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Params = Record<string, string | undefined>

async function request<T>(path: string, params: Params = {}, init: RequestInit = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ''}`
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers } })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'The analytics API is unreachable. Check that the backend is running on port 8000.')
  }
  if (!res.ok) {
    let detail = `Request failed with HTTP ${res.status}.`
    try {
      const body = await res.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

export interface AnalysisQuery {
  start: string
  end: string
  cutoff: CutoffId
  alignment: AlignmentId
}

const q = (a: AnalysisQuery): Params => ({ ...a })

export const api = {
  meta: (signal?: AbortSignal) => request<MetaResponse>('/api/meta', {}, { signal }),
  refresh: () => request<MetaResponse>('/api/refresh', {}, { method: 'POST' }),
  overview: (a: AnalysisQuery, signal?: AbortSignal) => request<OverviewResponse>('/api/overview', q(a), { signal }),
  series: (a: AnalysisQuery, signal?: AbortSignal) =>
    request<SeriesResponse>('/api/forecast-vs-actual', q(a), { signal }),
  accuracy: (a: AnalysisQuery, signal?: AbortSignal) => request<AccuracyResponse>('/api/accuracy', q(a), { signal }),
  publications: (date: string, cutoff: CutoffId, signal?: AbortSignal) =>
    request<PublicationsResponse>('/api/forecast-publications', { date, cutoff }, { signal }),
}
