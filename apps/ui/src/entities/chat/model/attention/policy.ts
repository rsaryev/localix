/**
 * HOW MUCH EACH KIND OF "WAITING ON YOU" IS ALLOWED TO DEMAND.
 *
 * Before this table each surface decided for itself: the dock unioned two inboxes, the sidebar
 * knew only some kinds, the dialogs ranked HITL over plans by reading each other's state,
 * and a presented plan reached none of them. Every new kind meant finding all of those and
 * agreeing with them by hand, so the surfaces disagreed about what was waiting.
 *
 * WHAT is waiting is the server's answer (its attention registry, mirrored in `./store`). What
 * each kind is ALLOWED to do with the person's attention is decided once, here, and every channel
 * — the cross-session dialog, the sidebar row, the dock — reads the same row:
 *
 *   priority      lower first: which item a session's badge shows and the dialog raises
 *   interrupts    whether it may raise the cross-session dialog at all
 *   countsOnDock  whether its session counts toward the dock badge
 *
 * Presentation (icon, tone, the dialog body) is the UI half of the same contract, keyed by the
 * same union in `ui/attention/presentation.tsx`; `Record<AttentionKind, …>` keeps both exhaustive.
 */
import type { AttentionItem, AttentionKind } from '@localixai/api/client'

export interface AttentionPolicy {
  priority: number
  interrupts: boolean
  countsOnDock: boolean
}

export const ATTENTION_POLICY: Partial<Record<AttentionKind, AttentionPolicy>> = {
  // A run is BLOCKED on a value only the person has; nothing outranks it.
  interaction: { priority: 0, interrupts: true, countsOnDock: true },
  // The author stopped and waits for a decision before it implements anything.
  plan: { priority: 1, interrupts: true, countsOnDock: true },
}

/**
 * The policy for an item, or null for a kind this client does not know. A newer server may add a
 * kind before this client ships it; such an item is ignored rather than mis-ranked.
 */
export function attentionPolicyOf(item: AttentionItem): AttentionPolicy | null {
  return ATTENTION_POLICY[item.kind] ?? null
}
