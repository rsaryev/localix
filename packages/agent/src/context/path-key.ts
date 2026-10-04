/**
 * Canonical key for a filesystem path across the VBC dependency graph.
 *
 * Trimmed, leading `./` stripped, lowercased — so a tool-INPUT path (`./src/a.ts`),
 * a free-TEXT mention (`src/a.ts`), and a supersession TARGET all collapse to ONE
 * key. Previously the target resolver stripped `./` but the entity/inverted-index
 * keys did not, so a `./`-prefixed path produced a different key than its plain
 * mention and the dep graph silently missed that edge (under-scoring a depended-on
 * message → eligible for earlier compression). Single source of truth, used by
 * targets.ts, entities.ts, and dep-graph.ts.
 */
export function normalizePathKey(p: string): string {
  return p.trim().replace(/^\.\//, '').toLowerCase()
}
