import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

import type { UpdateOffer } from './activityItems'

/**
 * Whether the person hid the Store's update offer from the composer strip, remembered across
 * launches by the offer's FINGERPRINT (the set of versions it is about). A different set — one
 * more package, a newer version — is a different offer and shows again, like the app's own notice
 * (`localix.update.dismissed`, `useDesktopUpdate.ts`). The Event Center lists every offer anyway,
 * so a hidden strip loses nothing.
 */
const DISMISSED_STORE_UPDATES = 'localix.update.dismissed.store'

const listeners = new Set<() => void>()
let revision = 0
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function dismissUpdateOffer(offer: Pick<UpdateOffer, 'id' | 'fingerprint'>): void {
  if (offer.id === 'app') return
  // A blocked store keeps nothing; the offer then shows again on the next launch.
  saveString(DISMISSED_STORE_UPDATES, offer.fingerprint)
  revision += 1
  for (const listener of listeners) listener()
}

export function isUpdateOfferDismissed(offer: Pick<UpdateOffer, 'id' | 'fingerprint'>): boolean {
  if (offer.id === 'app') return false
  return loadString(DISMISSED_STORE_UPDATES) === offer.fingerprint
}

/** Re-render when an offer is hidden, in this window. */
export const useUpdateDismissals = (): number =>
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  )
