import { useEffect, useState } from 'react'
import { verifySealed, type SealedView } from '@localixai/mini-app-sdk/sealed'

/**
 * Whether a revealed commitment reproduces the digest shown before the reveal — checked here, in
 * the person's own browser, not taken from the server's word. `null` until there is something to
 * check (the move is still sealed) or while the check runs.
 */
export function useVerified(view: SealedView | null): boolean | null {
  const [result, setResult] = useState<{ key: string; ok: boolean } | null>(null)
  // The fields, not the object: every poll delivers a new object for the same commitment.
  const owner = view?.owner ?? ''
  const digest = view?.digest ?? ''
  const value = view?.revealed ? view.value : null
  const salt = view?.revealed ? view.salt : null
  // An answer counts only for the commitment it was computed for, so a changed commitment reads
  // as "checking" again without the effect having to reset anything.
  const key = JSON.stringify([owner, digest, value, salt])
  useEffect(() => {
    if (value === null || salt === null) return
    let current = true
    void verifySealed({ revealed: true, owner, digest, value, salt }).then((ok) => {
      if (current) setResult({ key, ok })
    })
    return () => {
      current = false
    }
  }, [key, owner, digest, value, salt])
  return value !== null && salt !== null && result?.key === key ? result.ok : null
}
