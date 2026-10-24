import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Card({
  title,
  subtitle,
  actions,
  children,
  footer,
  className = '',
  bodyClassName = 'card-body',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="sub">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
      {footer && <footer className="card-foot">{footer}</footer>}
    </section>
  )
}

export function KpiCard({
  label,
  value,
  unit,
  hint,
  swatch,
  title,
}: {
  label: string
  value: string
  unit?: string
  hint?: ReactNode
  swatch?: string
  /** Full metric definition, exposed as a tooltip and to assistive tech. */
  title?: string
}) {
  return (
    <div className="card kpi" title={title}>
      <div className="kpi-label">
        {swatch && <span className="swatch" style={{ background: swatch }} aria-hidden />}
        {label}
      </div>
      <div className="kpi-value">
        {value}
        {unit && value !== '—' && <span className="unit">{unit}</span>}
      </div>
      {hint && <div className="kpi-hint">{hint}</div>}
      {title && <span className="visually-hidden">{title}</span>}
    </div>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  title,
}: {
  tone?: 'neutral' | 'accent' | 'soft' | 'warn' | 'critical'
  icon?: IconName
  children: ReactNode
  title?: string
}) {
  const cls = tone === 'neutral' ? 'badge' : `badge badge-${tone}`
  return (
    <span className={cls} title={title}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const cls = tone === 'info' ? 'notice' : `notice notice-${tone}`
  return (
    <div className={cls} role={tone === 'error' ? 'alert' : 'note'}>
      <Icon name={tone === 'info' ? 'info' : 'alert'} />
      <div>{children}</div>
    </div>
  )
}

export function LoadingState({ label = 'Loading analysis…' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" />
      <p>{label}</p>
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state" role="alert">
      <span style={{ color: 'var(--critical)' }}>
        <Icon name="alert" size={24} />
      </span>
      <h3>Couldn’t load this view</h3>
      <p style={{ maxWidth: '60ch' }}>{error.message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: '60ch' }}>{children}</p>}
    </div>
  )
}

export function SkeletonKpis({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-kpi" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card kpi">
          <div className="skeleton" style={{ height: 12, width: '60%' }} />
          <div className="skeleton" style={{ height: 26, width: '80%' }} />
          <div className="skeleton" style={{ height: 10, width: '50%' }} />
        </div>
      ))}
    </div>
  )
}
