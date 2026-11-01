import { join } from 'node:path'

import { installedLocally } from './local-install'
import { holdsOffer } from './store-activity'
import { installedBy, readInstallRecord } from './store-install'
import type { Offer } from './store-offer-types'

/** Why `offer` may not replace what its name holds now, or null. */
export async function nameConflict(offer: Offer, installRoot: string): Promise<string | null> {
  const dir = join(installRoot, offer.name)
  const by = await installedBy(dir)
  if (by === 'person')
    return `A mini app of yours is already called "${offer.name}"; rename or remove it first`
  if (!by || (await holdsOffer(offer, installRoot))) return null
  const record = await readInstallRecord(dir)
  const holder = record ? `"${offer.name}" from ${record.marketplace}` : `"${offer.name}"`
  return `${holder} is installed; remove it to install the one from ${offer.marketplace}`
}

/**
 * What Get on `offer` puts aside, in the person's words, or null: nothing holds its name, this
 * very app does, or a folder put here by hand does — its only copy, which nothing replaces.
 */
export async function replacement(offer: Offer, installRoot: string): Promise<string | null> {
  const dir = join(installRoot, offer.name)
  const by = await installedBy(dir)
  if (!by || (await holdsOffer(offer, installRoot))) return null
  if (by === 'person') {
    // Built from a folder elsewhere (`local-install.ts`): that folder keeps the source.
    return (await installedLocally(dir))
      ? `Replaces your "${offer.name}", built on this computer; its data stays`
      : null
  }
  const record = await readInstallRecord(dir)
  const holder = record ? `"${offer.name}" from ${record.marketplace}` : `"${offer.name}"`
  return `Replaces ${holder}; its data stays`
}
