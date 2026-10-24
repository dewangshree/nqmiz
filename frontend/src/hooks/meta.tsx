import { createContext, useContext, type ReactNode } from 'react'
import { api } from '../api/client'
import type { MetaResponse } from '../api/types'
import { useApi, type ApiState } from './useApi'

const MetaContext = createContext<ApiState<MetaResponse> | null>(null)

/** Fetches the analysis period, cutoff policies and data-quality metadata once for the whole app. */
export function MetaProvider({ children }: { children: ReactNode }) {
  const state = useApi('meta', (signal) => api.meta(signal))
  return <MetaContext.Provider value={state}>{children}</MetaContext.Provider>
}

export function useMetaState(): ApiState<MetaResponse> {
  const ctx = useContext(MetaContext)
  if (!ctx) throw new Error('useMetaState must be used inside MetaProvider')
  return ctx
}

/** For components rendered only after meta has loaded (see AppShell). */
export function useMeta(): MetaResponse {
  const { data } = useMetaState()
  if (!data) throw new Error('useMeta called before metadata loaded')
  return data
}
