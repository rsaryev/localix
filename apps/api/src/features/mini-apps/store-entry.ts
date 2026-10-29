import type { ListingSuits } from '@localixai/store'

import { iconOf, isIncompatible } from './store-activity'
import type { MiniAppPublisher, Offer } from './store-offers'

/** One app's row in the store (`store.ts`): what a catalog offers, beside what is installed. */

export type MiniAppJobPhase = 'queued' | 'downloading' | 'installing' | 'done' | 'failed'

export interface MiniAppJob {
  phase: MiniAppJobPhase
  /** While downloading: bytes so far, and of how many. */
  received?: number
  total?: number
  error?: string
}

export interface MiniAppStoreEntry {
  name: string
  displayName?: string
  description: string
  category?: string
  /** The version the catalog offers. */
  version?: string
  publisher: MiniAppPublisher
  /** The catalog it comes from, as the catalog list names it. */
  source: string
  /** Where the host serves its icon; the row draws a monogram when it has none. */
  icon?: string
  tags?: string[]
  /** In the Featured group above the rest (the Localix catalog only). */
  featured?: boolean
  /** Installed on its own on a new installation (the Localix catalog only, `recommended.ts`). */
  recommended?: boolean
  /** What it is for, for recommendations (the Localix catalog only). */
  suits?: ListingSuits
  /** The kinds of file it opens (`docx`, `request.json`). */
  opens?: string[]
  surfaces?: string[]
  /** The names of the `/<app>:<command>` commands its manifest declares. */
  commands?: string[]
  /** What is on this machine, or null. */
  installed: { version?: string } | null
  /** The catalog offers a version other than the installed one. */
  update: boolean
  /** Built for a newer mini app contract than this Localix runs: it cannot be installed. */
  incompatible?: boolean
  job?: MiniAppJob
}

/** The store row for `offer`, given the manifest installed under its name and its job in flight. */
export function storeEntry(
  offer: Offer,
  installed: Record<string, unknown> | null | undefined,
  job: MiniAppJob | undefined,
): MiniAppStoreEntry {
  const installedVersion = typeof installed?.version === 'string' ? installed.version : undefined
  const { tags, featured, recommended, suits, opens, surfaces, commands } = offer.store
  const icon = iconOf(offer)
  return {
    name: offer.name,
    ...(offer.displayName ? { displayName: offer.displayName } : {}),
    description: offer.description,
    ...(offer.category ? { category: offer.category } : {}),
    ...(offer.version ? { version: offer.version } : {}),
    publisher: offer.publisher,
    source: offer.source,
    ...(icon ? { icon } : {}),
    ...(tags.length ? { tags } : {}),
    ...(featured ? { featured: true } : {}),
    ...(recommended ? { recommended: true } : {}),
    ...(suits ? { suits } : {}),
    ...(opens ? { opens } : {}),
    ...(surfaces ? { surfaces } : {}),
    ...(commands?.length ? { commands } : {}),
    installed: installed ? (installedVersion ? { version: installedVersion } : {}) : null,
    update: Boolean(installed && offer.version && installedVersion !== offer.version),
    ...(isIncompatible(offer) ? { incompatible: true } : {}),
    ...(job ? { job } : {}),
  }
}
