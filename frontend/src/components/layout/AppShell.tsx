import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMetaState } from '../../hooks/meta'
import { fmtDate } from '../../lib/format'
import { ROUTES } from '../../routes'
import { Icon } from '../ui/Icon'
import { ErrorState, LoadingState } from '../ui/primitives'
import { FilterBar } from './FilterBar'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="btn icon-btn"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

export function AppShell() {
  const meta = useMetaState()
  const location = useLocation()
  const route = ROUTES.find((r) => r.path === location.pathname) ?? null

  useEffect(() => {
    document.title = `${route?.title ?? 'Not found'} · Wind Forecast Analytics`
  }, [route])

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="wind" size={18} />
          </div>
          <div>
            <div className="brand-name">Wind Forecast Analytics</div>
            <div className="brand-sub">GB day-ahead procurement</div>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          {ROUTES.map((r) => (
            // Preserve the shared filters when moving between sections.
            <NavLink key={r.path} to={{ pathname: r.path, search: location.search }} end>
              <Icon name={r.icon} />
              {r.nav}
            </NavLink>
          ))}
        </nav>
        {meta.data && (
          <div className="sidebar-foot">
            <div>
              <div className="field-label">Decisions</div>
              {fmtDate(meta.data.decision_date_first)} – {fmtDate(meta.data.decision_date_last)} 2026
            </div>
            <div>
              <div className="field-label">Deliveries</div>
              {fmtDate(meta.data.delivery_date_first)} – {fmtDate(meta.data.delivery_date_last)} 2026
            </div>
            <div>Source: Elexon BMRS (FUELHH, WINDFOR)</div>
          </div>
        )}
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-row">
            <div className="page-title">
              <h1>{route?.title ?? 'Page not found'}</h1>
              {route && <p>{route.description}</p>}
            </div>
            <ThemeToggle />
          </div>
          {meta.data && route && route.filters.length > 0 && <FilterBar show={route.filters} />}
        </header>
        <main className="content" id="main">
          {meta.error ? (
            <div className="card">
              <ErrorState error={meta.error} onRetry={meta.reload} />
            </div>
          ) : !meta.data ? (
            <div className="card">
              <LoadingState label="Loading Elexon source data…" />
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="card">
                  <LoadingState label="Loading section…" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  )
}
