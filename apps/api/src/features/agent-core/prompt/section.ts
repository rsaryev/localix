/**
 * ONE SECTION OF A RUN'S PROMPT, declared rather than spliced in.
 *
 * A section says where it belongs (`tier`) and renders from the run's facts; it renders nothing
 * when it does not apply. The catalog (`catalog.ts`) is the order, so a section's place is a
 * line in a list, not an index computed from whichever sections happened to render before it.
 *
 *  - `stable` — inside the cached system prompt. Per-turn content here rewrites the prefix every
 *               turn, and the whole system+tools prefix misses the cache with it.
 *  - `state`  — a standing fact in the volatile tail (`<runtime-context>`), re-sent only when its
 *               text changes.
 *  - `turn`   — about this turn only, never carried forward.
 */
import type { PromptFacts } from './facts'

export type PromptTier = 'stable' | 'state' | 'turn'

export interface PromptSection {
  /** A stable name; a tail section's runtime-context key. */
  readonly id: string
  readonly tier: PromptTier
  /**
   * The heading it renders under, for the cache-boundary contract (`cache-tiers.test.ts`). Absent
   * only for the agent's identity, which carries the agent's own text.
   */
  readonly heading?: string
  render(facts: PromptFacts): string | null | undefined
}
