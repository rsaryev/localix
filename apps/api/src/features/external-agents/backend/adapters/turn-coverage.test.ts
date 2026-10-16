/**
 * Every agent we can LAUNCH must be an agent whose turn we can read — or a named exception.
 *
 * The live half asks `readTurnState` wherever the screen manifest degraded to its idle guess, and
 * `idle` settles a wait. An adapter that simply does not implement it disappears into that guess
 * with nothing to notice: no error, no warning, and a `wait` that returns instantly on a busy agent.
 * That is the failure this whole reader exists to prevent, so declining has to be a DECISION rather
 * than an omission.
 *
 * The exceptions below are properties of storage, verified on a real local history:
 *  - opencode writes one JSON file per message under `storage/message/<session>/`, so there is no
 *    single file whose end is the session's end;
 *  - Gemini CLI rewrites a whole chat DOCUMENT on every turn, so a tail read yields no records at
 *    all — and the document carries no end marker to read instead.
 *
 * Both keep the manifest's answer, degraded reason and all. Removing an entry from this list means
 * an adapter must implement the method; adding one means writing down why it cannot.
 */

import { describe, expect, test } from 'bun:test'

import { PROVIDER_ADAPTERS } from './registry'
import { LAUNCH_KINDS } from '../live/launch-kinds'

/**
 * Providers whose storage cannot answer, each with the reason. EMPTY, and that is the point.
 *
 * It briefly held opencode and Gemini CLI, and both entries were wrong — they said "cannot answer"
 * where the truth was "cannot answer BY TAILING A FILE". opencode keeps a database whose newest
 * message row carries the role and a completion time; Gemini rewrites a document whose last message
 * carries the same. An exception list is where a wrong belief goes to become permanent, so an entry
 * here must state a property of the STORAGE, verified against real data on a real machine.
 */
const CANNOT_ANSWER: Record<string, string> = {}

describe('turn-state coverage', () => {
  test('every adapter either reads its turn or is listed as unable, with a reason', () => {
    for (const adapter of PROVIDER_ADAPTERS) {
      const reason = CANNOT_ANSWER[adapter.id]
      if (reason) {
        expect(reason.length, `${adapter.id} needs a real reason`).toBeGreaterThan(20)
        expect(
          typeof adapter.readTurnState,
          `${adapter.id} is listed as unable but implements readTurnState — remove it from the list`,
        ).toBe('undefined')
        continue
      }
      expect(
        typeof adapter.readTurnState,
        `${adapter.id} can be launched but cannot say whether its turn is running`,
      ).toBe('function')
    }
  })

  test('the list names only providers that exist', () => {
    // A stale entry would excuse an adapter that is no longer here while silently covering for a
    // new one that reused the id.
    const ids = new Set(PROVIDER_ADAPTERS.map((adapter) => adapter.id))
    for (const id of Object.keys(CANNOT_ANSWER))
      expect(ids.has(id), `${id} is not an adapter`).toBe(true)
  })

  test('the providers this guard covers are exactly the launchable ones', () => {
    // The asymmetry it protects against is launch-without-read, so the two sets have to match or
    // the guard answers for a population that is not the one at risk.
    const adapters = new Set(PROVIDER_ADAPTERS.map((adapter) => adapter.id))
    for (const kind of LAUNCH_KINDS) {
      expect(adapters.has(kind.provider), `${kind.provider} is launchable with no adapter`).toBe(
        true,
      )
    }
    expect(adapters.size).toBe(LAUNCH_KINDS.length)
  })
})
