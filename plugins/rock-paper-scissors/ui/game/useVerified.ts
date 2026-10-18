import { useEffect, useState } from 'react'
import { verifySealed, type SealedView } from '@localixai/plugin-sdk/sealed'

/**
 * Whether a revealed commitment reproduces the digest shown before the reveal — checked here, in
 * the person's own browser, not taken from the server's word. `null` until there is something to
 * check (the move is still sealed) or while the check runs.
 */
export function useVerified(view: SealedView | null): boolean | null {
  const [verified, setVerified] = useState<boolean | null>(null)
  // The fields, not the object: every poll delivers a new object for the same commitment.
  const owner = view?.owner ?? ''
  const digest = view?.digest ?? ''
  const value = view?.revealed ? view.value : null
  const salt = view?.revealed ? view.salt : null
  useEffect(() => {
    setVerified(null)
    if (value === null || salt === null) return
    let current = true
    void verifySealed({ revealed: true, owner, digest, value, salt }).then((ok) => {
      if (current) setVerified(ok)
    })
    return () => {
      current = false
    }
  }, [owner, digest, value, salt])
  return verified
}
