// Shared formatting. Delivery and publication times are shown in UK local time
// (Europe/London), the time zone the GB market and settlement dates use.

const UK = 'Europe/London'

const mwFmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const dec1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export const DASH = '—'

export function fmtMW(v: number | null | undefined, unit = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return unit ? `${mwFmt.format(v)} MW` : mwFmt.format(v)
}

export function fmtSignedMW(v: number | null | undefined, unit = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  const s = `${v > 0 ? '+' : v < 0 ? '−' : ''}${mwFmt.format(Math.abs(v))}`
  return unit ? `${s} MW` : s
}

export function fmtGW(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return `${dec1.format(v / 1000)} GW`
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return `${v.toFixed(digits)}%`
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH
  return mwFmt.format(v)
}

export function fmtHours(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH
  return `${dec1.format(v)} h`
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit', hour12: false })
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, day: '2-digit', month: 'short' })
const dayLongFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "14:30" in UK time. */
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso))
/** "14 Jan" in UK time. */
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso))
/** "Wed 14 Jan, 09:30" in UK time. */
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))

/** Format a YYYY-MM-DD settlement date without time-zone drift. */
export function fmtDate(d: string, long = false): string {
  const dt = new Date(`${d}T12:00:00Z`)
  return long ? dayLongFmt.format(dt) : dayFmt.format(dt)
}

export function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

export const STATUS_LABEL: Record<string, string> = {
  matched: 'Matched',
  missing_actual: 'Missing actual',
  missing_forecast: 'No eligible forecast',
  missing_both: 'Missing both',
  not_evaluated: 'Not evaluated (:30)',
}
