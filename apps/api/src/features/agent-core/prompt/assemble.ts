/**
 * A RUN'S PROMPT, rendered from its facts through the section catalog.
 *
 * One pass: the facts are derived once (`facts.ts`), every section of the catalog renders from
 * them in catalog order (`catalog.ts`), and the cached sections become the system prompt while
 * the volatile ones become the turn's runtime context. Nothing here decides what a section says
 * or whether it applies; that is each section's own business.
 */
import { promptFacts } from './facts'
import { PROMPT_SECTIONS } from './catalog'
import type { PromptSection } from './section'
import type { RuntimeSection } from './runtime-sections'
import type { BuildAgentSystemPromptParams, BuiltAgentSystemPromptParts } from './contracts'

export type { BuildAgentSystemPromptParams, BuiltAgentSystemPromptParts } from './contracts'

/**
 * The cached prefix must close before the tail opens: a cached section listed after a volatile
 * one would land below the boundary and leave the cache. Checked once, when the module loads.
 */
function assertTiersInOrder(sections: readonly PromptSection[]): void {
  const firstVolatile = sections.findIndex((section) => section.tier !== 'stable')
  const late = sections.slice(firstVolatile).find((section) => section.tier === 'stable')
  if (firstVolatile >= 0 && late) {
    throw new Error(`Prompt catalog lists cached section "${late.id}" after the volatile tail`)
  }
}
assertTiersInOrder(PROMPT_SECTIONS)

/** Build the cache-stable prompt and the volatile runtime tail without parsing rendered text. */
export function buildAgentSystemPromptParts(
  params: BuildAgentSystemPromptParams = {},
): BuiltAgentSystemPromptParts {
  const facts = promptFacts(params)
  const stable: string[] = []
  const runtimeSections: RuntimeSection[] = []
  for (const section of PROMPT_SECTIONS) {
    const text = section.render(facts)
    if (!text) continue
    if (section.tier === 'stable') stable.push(text)
    else runtimeSections.push({ key: section.id, scope: section.tier, text })
  }
  return { stablePrompt: stable.join('\n\n').trimEnd(), runtimeSections }
}

/** The complete prompt as one string, for callers that need it whole (the goldens, the lints). */
export function buildAgentSystemPrompt(params: BuildAgentSystemPromptParams = {}): string {
  const { stablePrompt, runtimeSections } = buildAgentSystemPromptParts(params)
  return [stablePrompt, ...runtimeSections.map((section) => section.text)].join('\n\n')
}
