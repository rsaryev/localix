import { useCallback, useState } from 'react'

/**
 * The MUTATION bookkeeping every settings registry shares: which row is busy, what it
 * is busy doing, and the last mutation failure.
 *
 * It used to carry the load half too — `loading`, a `refreshKey`, and the trick for
 * showing a loading state without a synchronous setState in an effect. That belonged
 * to a hook that fetched its own list; the lists now project one capability document,
 * which owns its own loading and its own failure, and keeping a second copy here meant
 * two answers to "is this list ready".
 */
export interface RegistryScope {
  error: string | null
  setError: (error: string | null) => void
  /** Record name currently mutating (toggle/remove/save), for per-row busy UI. */
  busy: string | null
  /** Exact operation announced and shown under the active registry row. */
  busyLabel: string | null
  setBusy: (name: string | null, label?: string) => void
}

export function useRegistryScope(): RegistryScope {
  const [error, setError] = useState<string | null>(null)
  const [mutation, setMutation] = useState<{ name: string; label: string | null } | null>(null)
  const setBusy = useCallback(
    (name: string | null, label?: string) =>
      setMutation(name === null ? null : { name, label: label ?? null }),
    [],
  )

  return {
    error,
    setError,
    busy: mutation?.name ?? null,
    busyLabel: mutation?.label ?? null,
    setBusy,
  }
}
