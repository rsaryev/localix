import { useCallback } from 'react'

import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { invalidateCapabilities, useCapabilities } from './capabilityCache'

/**
 * The capability snapshot of an ARBITRARY scope, converged live.
 *
 * Settings is the reason this takes a scope at all: its picker routinely points at a
 * project that is NOT the one the workbench is showing, which is precisely how the
 * "mini app list updated but its tools stayed enabled" bug survived — two surfaces, two
 * endpoints, reconciled by hand.
 *
 * The fetching itself lives in {@link ./capabilityCache}, so this hook no longer owns
 * a request at all: readers of the ACTIVE scope are served from the document the
 * workbench already holds, and readers of any other scope share one request per scope
 * instead of one per hook instance.
 */
export interface ScopedCapabilitySnapshot {
  /** null until the first complete response — never a half-populated stand-in. */
  snapshot: CapabilitySnapshot | null
  loading: boolean
  error: string | null
  /** Re-read this scope now (a manual retry, or after a mutation the store misses). */
  refresh: () => void
}

export function useCapabilitySnapshot(scope: string, enabled = true): ScopedCapabilitySnapshot {
  const { snapshot, loading, error } = useCapabilities(scope, enabled)
  const refresh = useCallback(() => invalidateCapabilities(scope), [scope])
  return { snapshot, loading, error, refresh }
}
