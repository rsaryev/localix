import type { ContextRefExpansion, MessageContextBinding } from '@/shared/api/contracts'
import type { ExpansionBudget, ParsedContextRef } from '@localixai/api/context-refs'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import type { inlineCompletionReferences } from './sendRefs'

export interface ContextRefChip {
  ref: ParsedContextRef
  expansion: ContextRefExpansion | null
  /** True while the expansion is being fetched. */
  pending: boolean
  /** True for a structured (pinned, token-less) ref — the chip row renders ONLY
   *  these; a typed text token's representation is its inline highlight pill. */
  pinned: boolean
  /** True for an AMBIENT auto-link chip — derived from an open editor tab, re-arms
   *  after send; × dismisses auto-linking for that tab. */
  auto?: boolean
}

/** One ambient (tab-derived) auto-link: the ref + how to dismiss its source tab. */
export interface AutoRefInput {
  ref: ParsedContextRef
  /** Dismiss auto-linking for the source tab (the chip's ×). */
  dismiss: () => void
}

export const NO_AUTOS: readonly AutoRefInput[] = []

/** Dismiss raw ambient sources one by one; duplicate ref keys can belong to
 * different tabs, so this must never deduplicate before invoking callbacks. */
export function dismissAllAutoRefs(autos: readonly AutoRefInput[]): void {
  for (const auto of autos) auto.dismiss()
}

export interface UseContextRefsResult {
  /** Included (non-removed) refs with their expansion state — drives the chip row. */
  chips: ContextRefChip[]
  /** Total expanded chars across included refs (known so far). */
  totalChars: number
  budget: ExpansionBudget
  /** Human message for the warn/block chip. */
  budgetMessage: string | null
  /** How many refs the 20-per-message wire cap will drop at send (0 = none). */
  droppedCount: number
  /** The pinned (token-less, drag-added) refs — lets the composer treat a
   *  snippet-only draft as sendable and derive a fallback message text. */
  pinnedRefs: ParsedContextRef[]
  /** The chips the user linked, as references grounding the composer's Tab suggestion. */
  completionRefs: ReturnType<typeof inlineCompletionReferences>
  /** Exclude a text ref from expansion / remove a pinned ref (chip × button). */
  removeRef: (key: string) => void
  /**
   * Remove every context contribution from this draft in one action. Prompt
   * text stays intact; parsed @-tokens are excluded from the send, structured
   * pins are dropped, and every ambient source tab is dismissed.
   */
  clearAllRefs: () => void
  /**
   * Add a STRUCTURED (token-less) ref — e.g. a `snippet` dragged from the SQL Output
   * log. It carries its own inline content, so it rides the send without a prompt
   * token. Re-adding the same key REPLACES it (refreshes the captured content).
   */
  addPinnedRef: (ref: ParsedContextRef) => void
  /** Drop all pinned refs, or only the keys owned by one submitted draft. */
  clearPinnedRefs: (keys?: readonly string[]) => void
  /**
   * Budget preflight for a send: fetches sizes for any not-yet-expanded TEXT refs
   * (dry run — the server re-expands fresh at send time), unions the pinned
   * (inline-content) refs, and returns the wire refs to attach. Returns null when
   * the budget blocks the send; an empty array when there are no refs at all.
   */
  refsForSend: (text: string) => Promise<MessageContextBinding[] | null>
  /** Budget and materialize an explicit plugin action's context without staging chips/text. */
  bindingsForSend: (
    bindings: readonly MessageContextBindingDraft[],
  ) => Promise<MessageContextBinding[] | null>
}
