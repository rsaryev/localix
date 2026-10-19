import type { SessionQueueItem } from './contracts'

export interface QueueItemCapabilities {
  /** The exact payload may be atomically returned to a composer for editing. */
  canReturnToComposer: boolean
  /** The exact durable row may atomically interrupt and become the next delivery. */
  canPromote: boolean
  /** User-facing action label. */
  promoteLabel: 'Send now'
}

const USER_CAPABILITIES: QueueItemCapabilities = {
  canReturnToComposer: true,
  canPromote: true,
  promoteLabel: 'Send now',
}

const WAKE_CAPABILITIES: QueueItemCapabilities = {
  canReturnToComposer: false,
  canPromote: false,
  promoteLabel: 'Send now',
}

/**
 * Client-safe queue action policy. This mirrors the server authority boundary:
 * trusted internal wakes may only be deleted; user turns may be returned or
 * atomically promoted without remove/re-submit.
 */
export function queueItemCapabilities(kind: SessionQueueItem['kind']): QueueItemCapabilities {
  switch (kind) {
    case 'wake':
      return WAKE_CAPABILITIES
    case 'user':
      return USER_CAPABILITIES
  }
}

/**
 * `delivery` is derived live by the server on every queue publish, never stored:
 * `undefined` here is not old data but a CLIENT-LOCAL optimistic row the server has
 * not acknowledged yet (QueuePanel merges both). Such a row will drain as its own
 * turn unless the ack upgrades it, so "Next turn" is its truthful label. `held` is a
 * child's report waiting for its siblings, so their delegator answers them together.
 */
export function queueDeliveryLabel(
  delivery: SessionQueueItem['delivery'],
): 'Next tool' | 'Next turn' | 'Waits for other reports' {
  if (delivery === 'held') return 'Waits for other reports'
  return delivery === 'next-tool' ? 'Next tool' : 'Next turn'
}
