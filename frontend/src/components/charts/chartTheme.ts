import { useEffect, useState } from 'react'

export interface ChartColors {
  actual: string
  forecast: string
  alt: string
  over: string
  under: string
  grid: string
  axis: string
  text: string
  muted: string
  surface: string
  accent: string
}

const VARS: Record<keyof ChartColors, string> = {
  actual: '--series-actual',
  forecast: '--series-forecast',
  alt: '--series-alt',
  over: '--over',
  under: '--under',
  grid: '--grid',
  axis: '--axis',
  text: '--text-2',
  muted: '--muted',
  surface: '--surface',
  accent: '--accent',
}

function read(): ChartColors {
  const cs = getComputedStyle(document.documentElement)
  const out = {} as ChartColors
  for (const [k, v] of Object.entries(VARS)) out[k as keyof ChartColors] = cs.getPropertyValue(v).trim()
  return out
}

/**
 * Recharts needs concrete colour strings, so resolve the design tokens and
 * re-resolve whenever the theme (toggle or OS preference) changes.
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(read)
  useEffect(() => {
    const update = () => setColors(read())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])
  return colors
}

export const axisTick = (c: ChartColors) => ({ fill: c.muted, fontSize: 11.5 })

/** Compact MW tick label: 12,000 -> "12k". */
export const mwTick = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0)}k` : `${v}`)
