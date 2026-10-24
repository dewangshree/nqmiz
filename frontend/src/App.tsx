import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { MetaProvider } from './hooks/meta'
import NotFoundPage from './pages/NotFoundPage'

// Route-level code splitting: each section's charts load only when visited.
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const ForecastVsActualPage = lazy(() => import('./pages/ForecastVsActualPage'))
const AccuracyPage = lazy(() => import('./pages/AccuracyPage'))
const PublicationsPage = lazy(() => import('./pages/PublicationsPage'))
const MethodologyPage = lazy(() => import('./pages/MethodologyPage'))

export default function App() {
  return (
    <BrowserRouter>
      <MetaProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="forecast-vs-actual" element={<ForecastVsActualPage />} />
            <Route path="accuracy" element={<AccuracyPage />} />
            <Route path="publications" element={<PublicationsPage />} />
            <Route path="methodology" element={<MethodologyPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </MetaProvider>
    </BrowserRouter>
  )
}
