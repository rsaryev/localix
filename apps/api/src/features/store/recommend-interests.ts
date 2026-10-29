import type { Listing, RecommendReason } from '@localixai/store'

import { refKey } from './index-rows'
import type { WorkingPiece } from './service-types'

/**
 * WHAT THE PERSON IS INTERESTED IN, one query each (`docs/internals/store.md`, "Recommendations").
 * A single query made of everything at once lands between the topics and finds none of them
 * well, and the pieces at its end are cut first; so each interest is asked on its own and the
 * answers are fused (`recommend-rank.ts`). An interest carries the weight its kind of evidence
 * deserves and the reason a person is shown: the tab, the installs, the project.
 */

export interface Interest {
  text: string
  weight: number
  reason: RecommendReason
  /**
   * For a group of installs, its packages (`kind:id`) weighed by how lately each was installed:
   * the group asks with what they are (`recommend-candidates.ts`), its text only while none has
   * a vector.
   */
  members?: Array<{ key: string; weight: number }>
}

/** How much a kind of evidence counts: what the person linked most, the project least. */
export const INTEREST_WEIGHTS: Record<Exclude<RecommendReason['source'], 'trusted'>, number> = {
  linked: 1,
  open: 0.9,
  context: 0.8,
  installed: 0.7,
  project: 0.6,
}

/**
 * How much text one interest asks with: a few paragraphs, not a whole file. The embedding model
 * reads a bounded window anyway, and the start of a file (its imports, its first keys) says most
 * about what it is.
 */
export const INTEREST_CHARS = 600
/** Pieces of the working set asked about, highest priority first. */
const WORKING_INTERESTS = 4
/** Groups of installs asked about: one per category, the largest first. */
const INSTALLED_INTERESTS = 3
/** Installs one group's query names. */
const INSTALLED_PER_INTEREST = 6

/**
 * How much an install says about the person now: half as much every seventy days. An install the
 * log does not hold (made elsewhere, or before the log kept installs) counts as an old one.
 */
const HALF_LIFE_MS = 70 * 24 * 60 * 60 * 1000
const UNDATED = 0.3
/** What the oldest install still counts for in its group's mean. */
const MEMBER_FLOOR = 0.1

/** "Pen", "Pen and Box", "Pen, Box and 2 more". */
export function namesOf(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

const clipped = (text: string) => text.trim().slice(0, INTEREST_CHARS)

/**
 * The working set's pieces, highest priority first; one interest each. A piece read from a tab or
 * a chip is asked with its name first: `main.tf` says Terraform where its resources do not (with
 * EmbeddingGemma 2 on the golden set, Terraform's z for a `.tf` file rose from 0.9 to 2.2).
 */
function working(pieces: readonly WorkingPiece[]): Interest[] {
  const out: Interest[] = []
  for (const piece of [...pieces].sort((a, b) => b.priority - a.priority)) {
    const text = clipped(piece.label ? `${piece.label}\n${piece.content}` : piece.content)
    if (!text || out.some((interest) => interest.text === text)) continue
    const source = piece.linked ? 'linked' : piece.label ? 'open' : 'context'
    out.push({
      text,
      weight: INTEREST_WEIGHTS[source],
      reason: { source, ...(piece.label ? { label: piece.label.slice(0, 200) } : {}) },
    })
    if (out.length >= WORKING_INTERESTS) break
  }
  return out
}

/**
 * What the person chose to install, grouped by category: each group is one interest (a person
 * who installed three database tools and a font editor has two). An install counts for less as
 * it ages, so the groups that weigh most are asked about, the most recent install named first,
 * and a group installed into lately outweighs one nobody added to in a year: its weight runs from
 * 0.6 of an installed interest's, when all of it is old, to the whole, when one is new.
 */
function installed(chosen: readonly Listing[], installedAt: Recency): Interest[] {
  const groups = new Map<string, Array<{ listing: Listing; fresh: number }>>()
  for (const listing of chosen) {
    const category = listing.category ?? 'Other'
    const fresh = installedAt(refKey(listing.ref))
    groups.set(category, [...(groups.get(category) ?? []), { listing, fresh }])
  }
  const mass = (group: Array<{ fresh: number }>) => group.reduce((sum, of) => sum + of.fresh, 0)
  return [...groups.values()]
    .sort((a, b) => mass(b) - mass(a))
    .slice(0, INSTALLED_INTERESTS)
    .map((group) => {
      const members = [...group].sort((a, b) => b.fresh - a.fresh)
      const named = members.slice(0, INSTALLED_PER_INTEREST).map((of) => of.listing)
      return {
        text: clipped(
          named.map((listing) => `${listing.displayName}: ${listing.summary}`).join('\n'),
        ),
        weight: INTEREST_WEIGHTS.installed * (0.6 + 0.4 * members[0]!.fresh),
        reason: {
          source: 'installed' as const,
          label: namesOf(members.map((of) => of.listing.displayName)).slice(0, 200),
        },
        members: members.map((of) => ({
          key: refKey(of.listing.ref),
          weight: Math.max(MEMBER_FLOOR, of.fresh),
        })),
      }
    })
    .filter((interest) => interest.text)
}

/** How much an install (`kind:id`) still says, in (0, 1]. */
type Recency = (key: string) => number

/** The recency of installs made at these times (ISO 8601, by `kind:id`), as of `now`. */
export function recencyOf(at: ReadonlyMap<string, string>, now: number): Recency {
  return (key) => {
    const when = at.get(key)
    if (!when) return UNDATED
    return 0.5 ** (Math.max(0, now - Date.parse(when)) / HALF_LIFE_MS)
  }
}

/** Every interest the evidence holds: the working set, the installs, then the project. */
export function interestsOf(
  pieces: readonly WorkingPiece[],
  chosen: readonly Listing[],
  project: ReadonlySet<string>,
  recency: Recency = () => UNDATED,
): Interest[] {
  const words = [...project]
  return [
    ...working(pieces),
    ...installed(chosen, recency),
    ...(words.length
      ? [
          {
            text: clipped(words.join(' ')),
            weight: INTEREST_WEIGHTS.project,
            reason: { source: 'project' as const, label: words.slice(0, 3).join(', ') },
          },
        ]
      : []),
  ]
}
