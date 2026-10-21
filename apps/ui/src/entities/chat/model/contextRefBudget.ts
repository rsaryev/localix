import type { ContextRefExpansion } from '@/shared/api/contracts'
import {
  classifyExpansionBudget,
  type ExpansionBudget,
  type ParsedContextRef,
} from '@localixai/api/context-refs'

/** Local chip expansion for a pinned (inline-content) ref — its content IS the ref,
 *  so the size is known without a server round-trip. */
export function inlineExpansion(ref: ParsedContextRef): ContextRefExpansion {
  const content = ref.content ?? ''
  return {
    raw: ref.raw,
    ok: true,
    content,
    chars: content.length,
    ...(ref.language ? { language: ref.language } : {}),
  }
}

export interface RefBudgetSummary {
  budget: ExpansionBudget
  budgetMessage: string | null
}

/** Budget gate for the composer's refs: manual refs may block; ambient overflow only warns. */
export function summarizeRefBudget(input: {
  manualChars: number
  totalChars: number
  hasAnyRef: boolean
  contextTokens: number | undefined
}): RefBudgetSummary {
  const { manualChars, totalChars, hasAnyRef, contextTokens } = input
  const manualBudget = hasAnyRef ? classifyExpansionBudget(manualChars, contextTokens) : 'ok'
  const combinedBudget = hasAnyRef ? classifyExpansionBudget(totalChars, contextTokens) : 'ok'
  // An ambient overflow becomes a warning because send-time admission sheds those
  // refs. Only deliberate refs may hard-block the send button.
  const budget = manualBudget === 'block' ? 'block' : combinedBudget === 'ok' ? 'ok' : 'warn'
  const budgetMessage =
    manualBudget === 'block'
      ? `Manual references expand to ~${Math.round(manualChars / 1000)}k chars — over half the model's context window. Remove some references or narrow line ranges.`
      : combinedBudget === 'block'
        ? `References expand to ~${Math.round(totalChars / 1000)}k chars — oversized ambient tabs will be omitted automatically.`
        : combinedBudget === 'warn'
          ? `References expand to ~${Math.round(totalChars / 1000)}k chars (>25% of the context window).`
          : null
  return { budget, budgetMessage }
}
