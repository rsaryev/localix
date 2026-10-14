import type { MessageContextBinding } from '@/shared/api/contracts'

type Status = MessageContextBinding['resolution']['status']

/** How a context's resolution reads to a person: a word, and whether it needs attention. */
export interface ContextStatusPresentation {
  label: string
  /** `quiet` is the ordinary outcome; `attention` is a context the model did NOT get. */
  tone: 'quiet' | 'pending' | 'attention'
}

/**
 * Three tones, not two. `pending` is the second between an optimistic send and the server's
 * echo; reading it as a failure flashed every context as broken the instant it was sent. Every
 * other non-`resolved` outcome — nothing found, refused, ran out of road — is one the user
 * should see, because the model answered without that context.
 *
 * The resolution vocabulary is the runtime's (`out_of_scope`, `deadline_exceeded`, …); printing
 * it as-is put `resolved` after every row, which says nothing to anyone but the code. Each status
 * gets a word, and only the ones where the context did not reach the model are tinted — so a
 * glance finds the problem instead of reading every row.
 */
const PRESENTATION: Record<Status, ContextStatusPresentation> = {
  resolved: { label: 'Included', tone: 'quiet' },
  pending: { label: 'Resolving…', tone: 'pending' },
  // The provider found nothing, so the model got nothing: a real outcome, not a quiet one.
  empty: { label: 'Empty', tone: 'attention' },
  unsupported: { label: 'Unsupported', tone: 'attention' },
  out_of_scope: { label: 'Out of scope', tone: 'attention' },
  denied: { label: 'Denied', tone: 'attention' },
  timeout: { label: 'Timed out', tone: 'attention' },
  deadline_exceeded: { label: 'Timed out', tone: 'attention' },
  aborted: { label: 'Cancelled', tone: 'attention' },
  error: { label: 'Failed', tone: 'attention' },
}

export function contextStatus(status: Status): ContextStatusPresentation {
  return PRESENTATION[status] ?? { label: status, tone: 'attention' }
}

/** Whether any of a message's contexts did not reach the model — the trigger's warning. */
export function anyContextNeedsAttention(bindings: readonly MessageContextBinding[]): boolean {
  return bindings.some((binding) => contextStatus(binding.resolution.status).tone === 'attention')
}
