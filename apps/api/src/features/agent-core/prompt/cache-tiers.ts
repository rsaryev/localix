/**
 * Which side of the prompt-cache boundary each prompt section belongs on, by its heading.
 *
 * `buildAgentSystemPrompt` emits `# Runtime context` as the marker splitting the prompt in two,
 * and the run path caches everything ABOVE it as a stable prefix. So a section's position is not
 * a layout choice, it is a cost decision:
 *
 *  - `stable`   — inside the cacheable prefix. Putting per-turn content here rewrites the prefix
 *                 every turn, and the whole system+tools prefix misses cache with it. That is the
 *                 most expensive mistake available in the prompt.
 *  - `volatile` — in the tail the run moves out of the cached prefix. Putting session-stable
 *                 content here is the cheap mistake: correct output, needlessly excluded from
 *                 the cross-session cache.
 *
 * The declaration is each section's own `tier` in the catalog, with the reason beside it, and
 * this table is read off it. `cache-tiers.test.ts` compares it against a real render: a heading
 * that renders but no section declares fails, and so does a section whose text lands on the other
 * side of the marker than its tier says.
 *
 * Scope is exactly the sections the catalog positions relative to the marker. Model-facing text
 * assembled elsewhere — a skill tool's result, the runtime sections a host adds — is not placed
 * against this boundary and is deliberately absent.
 *
 * Token ceilings are NOT declared here. They are enforced where the content is assembled
 * (`capAggregatePromptContext`, `SKILL_LISTING_BUDGET`, `BACKGROUND_JOB_PROMPT_MAX_ITEMS`), and a
 * second, unenforced copy of that number would only be free to drift from it.
 */
import { PROMPT_SECTIONS } from './catalog'

export type PromptCacheTier = 'stable' | 'volatile'

export const PROMPT_SECTION_CACHE_TIERS: Readonly<Record<string, PromptCacheTier>> =
  Object.fromEntries(
    PROMPT_SECTIONS.flatMap((section) =>
      section.heading
        ? [[section.heading, section.tier === 'stable' ? 'stable' : 'volatile'] as const]
        : [],
    ),
  )
