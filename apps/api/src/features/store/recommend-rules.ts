import type { Listing, ListingSuits, RecommendReason } from '@localixai/store'

import { refKey } from './index-rows'
import { INTEREST_WEIGHTS, type Interest } from './recommend-interests'

/**
 * WHAT A PACKAGE SAYS IT IS FOR (`docs/internals/store.md`, "Recommendations"): the file names
 * and dependencies its source lists (`Listing.suits`), held against what the person has — the
 * files open in tabs, then the names at the project's root and the packages it depends on. A
 * match is the strongest evidence a recommendation has, as an editor's word that this package is
 * for that file; the core names no package, the sources do. Pure functions.
 */

export interface SuitEvidence {
  /** Files open in tabs, as their labels (a path or a name). */
  open: readonly string[]
  /** Names at the open project's root. */
  files: readonly string[]
  /** Packages the open project depends on, as its manifest writes them. */
  dependencies: readonly string[]
}

const baseName = (path: string) => path.split(/[\\/]/).at(-1) ?? path

/** A file name pattern: `*` stands for any characters within one name, case aside. */
function patternOf(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*')
  return new RegExp(`^${escaped}$`, 'i')
}

/** Why a listing suits what the person has: an open file, then the project; null for nothing. */
export function suitedBy(
  suits: ListingSuits | undefined,
  evidence: SuitEvidence,
): RecommendReason | null {
  if (!suits) return null
  const patterns = (suits.files ?? []).map(patternOf)
  const named = (names: readonly string[]) =>
    names.map(baseName).find((name) => patterns.some((pattern) => pattern.test(name)))
  const open = named(evidence.open)
  if (open) return { source: 'open', label: open }
  const file = named(evidence.files)
  if (file) return { source: 'project', label: file }
  const wanted = new Set(suits.dependencies ?? [])
  const dependency = evidence.dependencies.find((name) => wanted.has(name))
  return dependency ? { source: 'project', label: dependency } : null
}

/**
 * A match's score, on the scale a search scores a hit: above any meaning finds, so a package made
 * for the open file leads; its interest's weight still puts the open file before the project.
 */
const SUITED = 0.9

/**
 * The listings that suit what the person has, as interests of their own — one per file or
 * dependency they suit, so the reason names it — each with its answer, `[key, score]`.
 */
export function suitedInterests(
  listings: readonly Listing[],
  evidence: SuitEvidence,
): Array<{ interest: Interest; hits: Array<readonly [string, number]> }> {
  const byReason = new Map<string, { interest: Interest; hits: Array<readonly [string, number]> }>()
  for (const listing of listings) {
    const reason = suitedBy(listing.suits, evidence)
    if (!reason || reason.source === 'trusted') continue
    const id = `${reason.source}:${reason.label}`
    const held = byReason.get(id) ?? {
      interest: { text: '', weight: INTEREST_WEIGHTS[reason.source], reason },
      hits: [],
    }
    held.hits.push([refKey(listing.ref), SUITED])
    byReason.set(id, held)
  }
  return [...byReason.values()]
}
