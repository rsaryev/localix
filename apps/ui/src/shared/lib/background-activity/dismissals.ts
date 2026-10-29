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
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function dismissUpdateOffer(offer: Pick<UpdateOffer, 'id' | 'fingerprint'>): void {
  if (offer.id === 'app') return
  // A blocked store keeps nothing; the offer then shows again on the next launch.
  saveString(DISMISSED_STORE_UPDATES, offer.fingerprint)
  for (const listener of listeners) listener()
}

/** Whether `offer` is the one hidden; `hidden` is what {@link useHiddenUpdateOffer} returned. */
export function isUpdateOfferDismissed(
  offer: Pick<UpdateOffer, 'id' | 'fingerprint'>,
  hidden: string | null,
): boolean {
  return offer.id !== 'app' && hidden === offer.fingerprint
}

const hiddenOffer = () => loadString(DISMISSED_STORE_UPDATES)

/**
 * The fingerprint of the offer hidden, read again when one is hidden in this window. A value
 * rather than a re-render signal: the built app's React Compiler keeps a render's call to a module
 * function on its arguments, so a hidden offer stayed on screen.
 */
export const useHiddenUpdateOffer = (): string | null =>
  useSyncExternalStore(subscribe, hiddenOffer, () => null)
