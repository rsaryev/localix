import type { Listing, StoreActor, StoreProvider } from '@localixai/store'

import { errorMessage } from '../../lib/errors'
import type { StoreIndexRepository } from './index-repository'
import { cardOf, toIndexRow, toStateRow } from './index-rows'

/**
 * ONE PROVIDER INTO THE INDEX (`docs/internals/store-scale.md`, "Sync"): its listings, grouped by
 * source; a source whose cards hash to the revision already indexed costs that compare and no
 * write, any other is replaced in one transaction. The person's state — installs, jobs — is
 * replaced beside them when it moved. A provider that cannot list keeps what was indexed and
 * says why.
 */

export interface SyncOutcome {
  /** Some source's cards were written: the semantic collection reads them again. */
  cardsChanged: boolean
  /** Something a person sees moved: cards or their own state. */
  changed: boolean
  problems: string[]
}

const hash = (value: unknown) => Bun.hash(JSON.stringify(value)).toString(36)

export function createProviderSync(deps: { index: StoreIndexRepository; now: () => number }) {
  /** The state last written per person and kind, so an unchanged one is not written again. */
  const stateHashes = new Map<string, string>()

  async function writeSources(kind: string, listings: readonly Listing[]): Promise<boolean> {
    const bySource = new Map<string, Listing[]>()
    for (const listing of listings) {
      const list = bySource.get(listing.source.id) ?? []
      list.push(listing)
      bySource.set(listing.source.id, list)
    }
    let changed = (await deps.index.keepSources(kind, [...bySource.keys()])) > 0
    const now = deps.now()
    for (const [sourceId, own] of bySource) {
      const cards = own.map(cardOf).sort((a, b) => a.ref.id.localeCompare(b.ref.id))
      const revision = hash(cards)
      if ((await deps.index.sourceRevision(kind, sourceId)) === revision) continue
      await deps.index.replaceSource(
        kind,
        sourceId,
        cards.map((card) => toIndexRow(card, { now })),
        { revision, now: new Date(now).toISOString() },
      )
      changed = true
    }
    if (changed) await deps.index.markDuplicates()
    return changed
  }

  async function writeState(actor: StoreActor, kind: string, listings: readonly Listing[]) {
    const rows = listings.flatMap((listing) => toStateRow(listing) ?? [])
    const key = `${actor.userId}\u0000${kind}`
    const next = hash(rows)
    if (stateHashes.get(key) === next) return false
    await deps.index.replaceState(actor.userId, kind, rows)
    stateHashes.set(key, next)
    return true
  }

  return async function sync(provider: StoreProvider, actor: StoreActor): Promise<SyncOutcome> {
    let answer: Awaited<ReturnType<StoreProvider['listings']>>
    try {
      answer = await provider.listings(actor)
    } catch (error) {
      return { cardsChanged: false, changed: false, problems: [errorMessage(error)] }
    }
    const cardsChanged = await writeSources(provider.kind, answer.listings)
    const stateChanged = await writeState(actor, provider.kind, answer.listings)
    return {
      cardsChanged,
      changed: cardsChanged || stateChanged,
      problems: answer.problems,
    }
  }
}
