import { useEffect, useRef, useState } from 'react'
import type { Listing } from '@localixai/store'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { StoreAppExtra } from '@/shared/lib/storeAppExtra'
import { keyOf } from './filters'

/**
 * "Install as app": the install is queued as any other, and the app of its own is made once that
 * install has landed — its job done and the listing installed — because the app is drawn from
 * the installed package. Making it can fail on its own; the install stays, and the reason is kept
 * to show beside the listing.
 */
export function useAppAfterInstall(listings: readonly Listing[], extra: StoreAppExtra | undefined) {
  const waiting = useRef(new Set<string>())
  const [problems, setProblems] = useState<Record<string, string>>({})

  const make = (listing: Listing) => {
    if (!extra) return
    const key = keyOf(listing)
    setProblems(({ [key]: _gone, ...rest }) => rest)
    extra
      .make(listing)
      .catch((error: unknown) =>
        setProblems((current) => ({ ...current, [key]: errorMessage(error, 'It failed') })),
      )
  }

  useEffect(() => {
    for (const key of waiting.current) {
      const listing = listings.find((candidate) => keyOf(candidate) === key)
      if (!listing || listing.job?.phase === 'failed') {
        waiting.current.delete(key)
        continue
      }
      const landed = listing.installs.length > 0 && (!listing.job || listing.job.phase === 'done')
      if (!landed) continue
      waiting.current.delete(key)
      make(listing)
    }
  })

  return {
    /** Make the app once `listing`'s install lands. */
    afterInstall: (listing: Listing) => void waiting.current.add(keyOf(listing)),
    /** Make it now, for a listing already installed. */
    make,
    /** Why an app was not made, by listing key. */
    problems,
  }
}
