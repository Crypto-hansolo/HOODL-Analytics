import { useEffect, useRef, useState } from 'react'
import { STALE_AFTER_MS } from '../config'
import type { DataSource, FetchState } from '../types'
import { initialFetchState } from '../types'

interface FetchResult<T> {
  data: T
  source: DataSource
}

interface Options {
  intervalMs?: number
  enabled?: boolean
}

/**
 * Runs `fetcher` immediately and then on a poll interval. Tracks loading /
 * success / error / unavailable explicitly, attributes the winning source,
 * and marks previously-good data "stale" once it's older than
 * STALE_AFTER_MS instead of blanking the UI on a transient failure.
 */
export function useFetchState<T>(
  fetcher: () => Promise<FetchResult<T>>,
  deps: unknown[],
  options: Options = {},
): FetchState<T> {
  const { intervalMs, enabled = true } = options
  const [state, setState] = useState<FetchState<T>>(initialFetchState<T>())
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const myFetchGeneration = ++requestSeq.current

    async function run(isFirst: boolean) {
      setState((prev) => ({
        ...prev,
        status: prev.data === null ? 'loading' : prev.status,
      }))
      try {
        const { data, source } = await fetcher()
        if (cancelled || requestSeq.current !== myFetchGeneration) return
        setState({ status: 'success', data, source, error: null, updatedAt: Date.now(), stale: false })
      } catch (err) {
        if (cancelled || requestSeq.current !== myFetchGeneration) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        setState((prev) => {
          const hasData = prev.data !== null
          const isStale = hasData && prev.updatedAt !== null && Date.now() - prev.updatedAt > STALE_AFTER_MS
          return {
            ...prev,
            status: hasData ? prev.status : 'unavailable',
            error: message,
            stale: hasData ? isStale : false,
          }
        })
      }
      void isFirst
    }

    run(true)
    let timer: ReturnType<typeof setInterval> | undefined
    if (intervalMs) {
      timer = setInterval(() => run(false), intervalMs)
    }
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
