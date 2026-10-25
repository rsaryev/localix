import { useEffect, useRef, useState } from 'react'
import type { Listing, ListingRef } from '@localixai/store'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { StoreClient } from '@/shared/api/store-client'
import { subscribeResourceGeneration } from '@/shared/api/resourceGeneration'
import type { StoreInstallExtra } from '@/shared/lib/storeInstallExtra'

/** Why an extra was not made, by listing key. */
export type ExtraProblems = Record<string, string>

export const keyOf = (ref: ListingRef) => `${ref.kind}/${ref.id}`

/**
 * An install extra chosen with the install ("Install as app"): the install is queued as any
 * other, and the extra is made once that install has landed — its job done and the listing
 * installed — because it is drawn from the installed package. Each `store` poke reads the waiting
 * listings again. Making it can fail on its own; the install stays, and the reason is kept to show
 * beside the listing.
 */
export function useExtrasAfterInstall(client: StoreClient) {
  const waiting = useRef(new Map<string, { ref: ListingRef; extra: StoreInstallExtra }>())
  const [problems, setProblems] = useState<ExtraProblems>({})

  const make = (extra: StoreInstallExtra, listing: Listing) => {
    const key = keyOf(listing.ref)
    setProblems(({ [key]: _gone, ...rest }) => rest)
    extra.make(listing).catch((error: unknown) =>
      setProblems((current) => ({
        ...current,
        [key]: `the ${extra.makes} was not made: ${errorMessage(error, 'it failed')}`,
      })),
    )
  }

  useEffect(
    () =>
      subscribeResourceGeneration('store', () => {
        for (const [key, { ref, extra }] of waiting.current)
          void client
            .detail(ref)
            .then((listing) => {
              if (!waiting.current.has(key)) return
              if (listing.job?.phase === 'failed') return void waiting.current.delete(key)
              const landed =
                listing.installs.length > 0 && (!listing.job || listing.job.phase === 'done')
              if (!landed) return
              waiting.current.delete(key)
              make(extra, listing)
            })
            .catch(() => {})
      }),
    // `make` only sets state; the client is the Store's for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  )

  return {
    /** Make `extra` once `ref`'s install lands. */
    afterInstall: (extra: StoreInstallExtra, ref: ListingRef) =>
      void waiting.current.set(keyOf(ref), { ref, extra }),
    make,
    problems,
  }
}
