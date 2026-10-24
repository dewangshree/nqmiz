import type { FilterKey } from './components/layout/FilterBar'
import type { IconName } from './components/ui/Icon'

export interface RouteDef {
  path: string
  nav: string
  title: string
  description: string
  icon: IconName
  filters: FilterKey[]
}

export const ROUTES: RouteDef[] = [
  {
    path: '/',
    nav: 'Overview',
    title: 'Overview',
    description: 'Day-ahead wind forecast performance for purchasing decisions made in January 2026.',
    icon: 'overview',
    filters: ['range', 'cutoff', 'alignment'],
  },
  {
    path: '/forecast-vs-actual',
    nav: 'Forecast vs actual',
    title: 'Forecast vs actual',
    description: 'Selected day-ahead forecast against metered wind outturn, by delivery interval.',
    icon: 'chart',
    filters: ['range', 'cutoff', 'alignment'],
  },
  {
    path: '/accuracy',
    nav: 'Accuracy & error',
    title: 'Accuracy & error analysis',
    description: 'How large forecast errors were, in which direction, and when they occurred.',
    icon: 'target',
    filters: ['range', 'cutoff', 'alignment'],
  },
  {
    path: '/publications',
    nav: 'Publication history',
    title: 'Forecast publication history',
    description: 'Every WINDFOR publication for a delivery day, and which one was available at the cutoff.',
    icon: 'history',
    filters: ['cutoff'],
  },
  {
    path: '/methodology',
    nav: 'Data & methodology',
    title: 'Data & methodology',
    description: 'Sources, forecast-selection policy, metric definitions, data quality and limitations.',
    icon: 'info',
    filters: [],
  },
]
