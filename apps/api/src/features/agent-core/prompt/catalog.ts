/**
 * THE PROMPT, AS A LIST: every section a run's prompt can carry, in the order it renders.
 *
 * Position is a line here, not an index: the builder used to splice the role and the
 * collaboration rule in after whichever sections had rendered, so a section's place depended on
 * which of its neighbours were present. Cached sections come first, then the volatile tail;
 * `assemble.ts` refuses a catalog that interleaves them. The tier of each section is declared on
 * it, with the reason, and `cache-tiers.test.ts` checks the declaration against a real render.
 *
 * PRIMACY: identity, then the invariant "# Core principles", then role, collaboration,
 * discipline and tools. The most important behavioral rules lead the prompt instead of being
 * buried mid-discipline.
 */
import type { PromptSection } from './section'
import { CACHED_SECTIONS } from './catalog-cached'
import { RUN_SECTIONS } from './catalog-run'
import { TAIL_SECTIONS } from './catalog-tail'

export const PROMPT_SECTIONS: readonly PromptSection[] = [
  ...CACHED_SECTIONS,
  // The runtime context opens first (its heading is the cache marker); what depends on the kind
  // of run follows it, ahead of the rest of the tail.
  TAIL_SECTIONS[0]!,
  ...RUN_SECTIONS,
  ...TAIL_SECTIONS.slice(1),
]
