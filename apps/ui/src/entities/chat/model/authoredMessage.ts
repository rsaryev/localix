import type { MessageBinding } from '@/shared/api/contracts'

/**
 * Whether a send carries anything the person put there: text, or a binding they chose (an
 * attachment, a pinned or dragged context). The active tab's context rides every composer send
 * by itself, so on its own it is not a message — sending it started empty turns.
 */
export function carriesAuthoredContent(
  text: string,
  bindings: readonly MessageBinding[] | undefined,
): boolean {
  return hasAuthoredInput(
    text,
    (bindings ?? []).filter((binding) => !('source' in binding && binding.source === 'active-tab'))
      .length,
  )
}

/**
 * The rule itself, for a caller that counts what the person chose rather than holding the
 * bindings: words, or at least one attachment or pinned reference. The composer's Send button,
 * its Enter key and the send pipeline all ask this, so they cannot disagree about "empty".
 */
export function hasAuthoredInput(text: string, chosenBindingCount: number): boolean {
  return text.trim().length > 0 || chosenBindingCount > 0
}
