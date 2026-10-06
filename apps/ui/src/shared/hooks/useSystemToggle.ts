import { useCallback, useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { SystemToggleState } from '@/shared/api/system-client'
import { enqueueMicrotask } from '@/shared/lib/enqueueMicrotask'
import { useResourceRevision } from '@/shared/api/useResourceRevision'

/**
 * Read + flip one host-level system control by id (e.g. 'keep-awake'). Generic —
 * any future toggle works with no changes here. Returns null until loaded; the
 * `available` flag lets callers hide controls the host doesn't support.
 */
export function useSystemToggle(id: string, enabled = true) {
  const revision = useResourceRevision('system', enabled)
  const [state, setState] = useState<SystemToggleState | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    enqueueMicrotask(() => {
      if (!alive) return
      void backendClient
        .listSystemToggles()
        .then((toggles) => {
          if (alive) setState(toggles.find((t) => t.id === id) ?? null)
        })
        .catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [id, enabled, revision])

  const toggle = useCallback(async () => {
    if (busy || !state) return
    setBusy(true)
    try {
      setState(await backendClient.setSystemToggle(id, !state.enabled))
    } catch {
      /* leave prior state on failure */
    } finally {
      setBusy(false)
    }
  }, [busy, state, id])

  return { state, toggle, busy }
}
