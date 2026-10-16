import { useEffect, useSyncExternalStore } from 'react'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  decideConfirmation,
  pendingConfirmation,
  registerConfirmationHost,
  subscribeConfirmation,
} from '@/shared/lib/confirmAction'

/**
 * The one confirmation every action the app cannot take back waits on. Mounted ONCE, at the root
 * layout, because the requests come from everywhere — a link in a book in the reader, a rail button
 * about to reset the workspace, a palette command about to wipe the event history — and the answer
 * must not depend on which surface asked.
 *
 * Deliberately knows nothing about links OR layouts: it renders the descriptor it is given.
 * Registering is what tells the gate a dialog can actually be shown; while no
 * host is mounted the gate performs actions directly rather than waiting for an
 * answer that could never arrive.
 */
export function ActionConfirm() {
  useEffect(() => registerConfirmationHost(), [])
  const pending = useSyncExternalStore(
    subscribeConfirmation,
    pendingConfirmation,
    // Server/prerender snapshot: nothing is ever pending before hydration.
    () => null,
  )

  return (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ''}
      description={pending?.detail}
      confirmLabel={pending?.confirmLabel ?? 'Continue'}
      cancelLabel={pending?.cancelLabel ?? 'Cancel'}
      variant={pending?.variant ?? 'default'}
      onConfirm={() => decideConfirmation(true)}
      onClose={() => decideConfirmation(false)}
    />
  )
}
