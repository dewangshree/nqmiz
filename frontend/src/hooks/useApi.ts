import { useCallback, useEffect, useRef, useState } from 'react'

export interface ApiState<T> {
  data: T | undefined
  error: Error | undefined
  /** True while a request is in flight. `data` keeps the previous result so the UI can dim instead of flashing. */
  loading: boolean
  reload: () => void
}

/**
 * Runs `fetcher` whenever `key` changes. Each run gets its own AbortController,
 * so a slow earlier response can never overwrite a newer one.
 */
export function useApi<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>): ApiState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<Error>()
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  // The fetcher closure changes every render; only `key` decides when to refetch.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') setError(err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload }
}
