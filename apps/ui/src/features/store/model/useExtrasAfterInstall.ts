import { useEffect, useRef, useState } from 'react'
import type { Listing } from '@localixai/store'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { keyOf } from './filters'

/** Why an extra was not made, by listing key: "the desktop app was not made: …". */
export type ExtraProblems = Record<string, string>

/**
 * An install extra chosen with the install ("Install as app"): the install is queued as any
 * other, and the extra is made once that install has landed — its job done and the listing
 * installed — because it is drawn from the installed package. Making it can fail on its own; the
 * install stays, and the reason is kept to show beside the listing.
 */
export function useExtrasAfterInstall(
  listings: readonly Listing[],
  extras: readonly StoreInstallExtra[],
) {
  const waiting = useRef(new Map<string, string>())
  const [problems, setProblems] = useState<ExtraProblems>({})

  const make = (extra: StoreInstallExtra, listing: Listing) => {
    const key = keyOf(listing)
    setProblems(({ [key]: _gone, ...rest }) => rest)
    extra.make(listing).catch((error: unknown) =>
      setProblems((current) => ({
        ...current,
        [key]: `the ${extra.makes} was not made: ${errorMessage(error, 'it failed')}`,
      })),
    )
  }

  useEffect(() => {
    for (const [key, id] of waiting.current) {
      const listing = listings.find((candidate) => keyOf(candidate) === key)
      const extra = extras.find((candidate) => candidate.id === id)
      if (!listing || !extra || listing.job?.phase === 'failed') {
        waiting.current.delete(key)
        continue
      }
      const landed = listing.installs.length > 0 && (!listing.job || listing.job.phase === 'done')
      if (!landed) continue
      waiting.current.delete(key)
      make(extra, listing)
    }
  })

  return {
    /** Make `extra` once `listing`'s install lands. */
    afterInstall: (extra: StoreInstallExtra, listing: Listing) =>
      void waiting.current.set(keyOf(listing), extra.id),
    /** Make it now, for a listing already installed. */
    make,
    /** Why an extra was not made, by listing key. */
    problems,
  }
}
