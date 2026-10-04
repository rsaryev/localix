/**
 * How every completion destination turns Context Fabric output into prompt context: the editor's
 * edit prediction and every text-input ghost surface alike.
 *
 * The defect it exists to stop is ORDER. Fabric's packer bounds contributions by bytes and DROPS
 * whatever does not fit; the excerpt picker (`pickRelevantExcerpt`) can cut a large contribution
 * down to its relevant lines. Edit prediction ran the packer at the PROMPT budget first — twice,
 * in `resolveExplicit` and again before ranking — so a linked 20 KB schema was gone before the
 * picker could keep the three tables near the caret. Here policy runs without a byte budget,
 * then ranking, then excerpting, then the prompt budget: in that order and nowhere else.
 */
import { CONTEXT_UNAVAILABLE_KIND } from '@localixai/plugin-sdk/backend'

import type { ContextContribution } from '../context-fabric/contracts'
import { packContextContributions } from '../context-fabric/manager'
import {
  packContextWindows,
  rankContextWindows,
  renderWindowGroup,
  type RankedContextWindow,
} from './predict-next-edit-context'

/**
 * What a completion request asks Fabric for BEFORE excerpting. Generous on purpose: it bounds
 * the raw material a resolver may return, not what reaches the prompt — that is `budgetChars`.
 */
export const COMPLETION_RAW_CONTEXT_BYTES = 512 * 1024

export interface CompletionContextBudget {
  /** Total characters of context in the prompt. */
  budgetChars: number
  /** Windows kept after ranking. */
  maxWindows: number
  /** Characters one window may keep, excerpted around the query symbols. */
  perWindowChars: number
}

/** A stable, readable header for a window: where the text came from, never an internal id. */
function windowLabel(item: ContextContribution): string {
  return item.uri ?? item.source?.path ?? item.kind
}

/** Bounded so one provider's self-declared priority cannot outrank relevance entirely. */
function priorityBoost(priority: number): number {
  return Math.max(-500, Math.min(500, priority - 1000))
}

export function packCompletionContext(
  items: readonly ContextContribution[],
  options: {
    querySymbols: Set<string>
    budget: CompletionContextBudget
    activeUri?: string
  },
): RankedContextWindow[] {
  // A reason ("could not be read") is for a sent message, where the user expects every chip to
  // be answered for; in a speculative completion prompt it is noise.
  const usable = items.filter((item) => item.kind !== CONTEXT_UNAVAILABLE_KIND)
  const admitted = packContextContributions(usable, {
    ...(options.activeUri ? { activeUri: options.activeUri } : {}),
    maxBytes: Number.POSITIVE_INFINITY,
    maxItems: Number.POSITIVE_INFINITY,
    // A speculative auxiliary call never reads sensitive context.
    allowSensitive: false,
  })
  const candidates = admitted.contributions
    // The active document is already in the prompt whole; a working set that includes its own
    // tab would spend the context budget on a second copy of it.
    .filter((item) => !options.activeUri || item.uri !== options.activeUri)
    .map((item, index) => ({
      filepath: windowLabel(item),
      content: item.content,
      source: 'provided' as const,
      recencyIndex: index,
      boost: priorityBoost(item.priority),
    }))
  return packContextWindows(
    rankContextWindows(candidates, options.querySymbols, new Set()),
    options.budget.budgetChars,
    options.budget.maxWindows,
    options.budget.perWindowChars,
    options.querySymbols,
  )
}

/** The packed windows as one prompt block, or `''` when nothing survived. */
export function renderCompletionContext(windows: readonly RankedContextWindow[]): string {
  return renderWindowGroup([...windows])
}
