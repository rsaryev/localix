import type { ComponentType } from 'react'
import type { Listing } from '@localixai/store'

/**
 * Something a listing can get beside a plain install, offered by the feature that knows which
 * listings qualify — a mini app made into an app of its own on this computer, say. The Store
 * knows no package kind (`docs/internals/store.md`): it renders every extra the same way, an icon
 * button beside Install on a card, a labelled button beside it on a listing's page, and Add or
 * Remove on the page once installed, in the words and with the glyph the extra brings.
 */
export interface StoreInstallExtra {
  /** Stable among the extras. */
  id: string
  /** The action that installs and then makes it: "Install as app". */
  label: string
  /** One sentence on what it adds, for the tooltip. */
  hint: string
  icon: ComponentType<{ className?: string }>
  /** What it makes, for "Add …", "Remove …" and "the … was not made": "desktop app". */
  makes: string
  /** Whether this listing can have it here. */
  available: (listing: Listing) => boolean
  has: (listing: Listing) => boolean
  /** Make it for an installed listing; rejects with what went wrong. */
  make: (listing: Listing) => Promise<void>
  remove: (listing: Listing) => Promise<void>
}

type UseStoreInstallExtra = () => StoreInstallExtra | undefined

const hooks: UseStoreInstallExtra[] = []

/**
 * Offer a hook that reads one extra, kept current while the Store is shown, and undefined where
 * it is not offered here. Called at start-up, before the Store renders, so the hooks a render
 * calls stay the same from one render to the next. Returns its withdrawal.
 */
export function provideStoreInstallExtra(hook: UseStoreInstallExtra): () => void {
  if (!hooks.includes(hook)) hooks.push(hook)
  return () => {
    const at = hooks.indexOf(hook)
    if (at >= 0) hooks.splice(at, 1)
  }
}

/**
 * Where an installed listing opens — a mini app's screen — as a `localix://` address, offered by
 * the feature that knows; undefined when it has nothing to open. The Store's Get button says Open
 * for a listing one of these answers for, and Installed otherwise; it names no kind.
 */
export type StoreOpener = (listing: Listing) => string | undefined

const openers: StoreOpener[] = []

/** Offer an opener; returns its withdrawal. */
export function provideStoreOpener(opener: StoreOpener): () => void {
  if (!openers.includes(opener)) openers.push(opener)
  return () => {
    const at = openers.indexOf(opener)
    if (at >= 0) openers.splice(at, 1)
  }
}

/** Where an installed listing opens, by the first opener that knows. */
export function storeOpenAddress(listing: Listing): string | undefined {
  if (listing.installs.length === 0) return undefined
  for (const opener of openers) {
    const address = opener(listing)
    if (address) return address
  }
  return undefined
}

/** Every extra offered here. */
export function useStoreInstallExtras(): StoreInstallExtra[] {
  return hooks.flatMap((hook) => {
    const extra = hook()
    return extra ? [extra] : []
  })
}
