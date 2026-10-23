/**
 * One saved request, for its tab.
 *
 * A one-shot load, unlike the sidebar's slow poll: a tab is looking at a request the user opened,
 * and re-fetching it on a timer could swap the thing under their cursor mid-read. The sidebar
 * polls because its job is to notice what changed; the tab's job is to hold still.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { RequestInfo, ResolvedPreview } from '../../backend/contracts'
import { restApi } from '../restApi'

export function useRequest(sessionId: string, name: string) {
  const workItemVisible = useWorkItemVisible()
  const [request, setRequest] = useState<RequestInfo | null>(null)
  const [resolved, setResolved] = useState<ResolvedPreview | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const res = await restApi.get(sessionId, name)
      if (seq !== loadSeq.current) return
      setRequest(res.request)
      setResolved(res.resolved)
      setError(null)
    } catch (err) {
      if (seq !== loadSeq.current) return
      setRequest(null)
      setResolved(undefined)
      acknowledgeInline(err)
      setError(err instanceof Error ? err.message : `Could not load “${name}”.`)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [sessionId, name])

  useEffect(() => {
    if (!workItemVisible) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
      loadSeq.current += 1
    }
  }, [load, workItemVisible])

  return { request, resolved, loading, error, reload: load }
}
