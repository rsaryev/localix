/**
 * Provider status for the filter bar.
 *
 * Loaded independently of the roster so an unreadable provider is reported even when the roster
 * comes back empty — an empty list must never be the only evidence that a scan failed.
 */
import { useCallback, useEffect, useState } from 'react'
import { acknowledgeInline } from '@localixai/plugin-sdk/ui'
import { ExternalAgentsApiError, externalAgentsApi } from '../api/externalAgentsApi'
import type { ProviderStatus } from './types'

export interface ProvidersState {
  providers: ProviderStatus[]
  loading: boolean
  error: string | null
  /** The raw text behind `error`. Event Center only, never on the line. */
  errorDetail: string | null
  reload: () => void
}

/** `active` is the owning work item's visibility: a warm tab stays mounted while hidden, and a
 *  provider scan touches four history roots on disk — not something to spend for a hidden tab. */
export function useProviders(reloadToken: number, active: boolean): ProvidersState {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [localToken, setLocalToken] = useState(0)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setLoading(true)
    void externalAgentsApi
      .providers()
      .then((next) => {
        if (cancelled) return
        setProviders(next)
        setError(null)
        setErrorDetail(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setProviders([])
        acknowledgeInline(cause)
        setError(
          cause instanceof Error ? cause.message : 'Could not list the agent providers here.',
        )
        setErrorDetail(cause instanceof ExternalAgentsApiError ? (cause.detail ?? null) : null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, reloadToken, localToken])

  const reload = useCallback(() => setLocalToken((n) => n + 1), [])
  return { providers, loading, error, errorDetail, reload }
}

/** A provider is unreachable when its scan failed, or when none of its roots exist here. */
export function isProviderUnavailable(status: ProviderStatus): boolean {
  if (status.error) return true
  return status.roots.length > 0 && status.roots.every((root) => !root.exists)
}
