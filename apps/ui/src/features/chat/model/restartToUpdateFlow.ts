/**
 * The restart-to-update decision, loaded on the click by `restartToUpdate.ts`.
 *
 * When something would be interrupted, the person is asked through the one confirmation gate
 * (`shared/lib/confirmAction`), naming what stops. When nothing would, the install starts at
 * once: a confirmation with nothing to confirm is one people learn to click through, and then it
 * fails the day it matters.
 *
 * The gate and the failure report are HANDED IN, like the roster, so this module has no runtime
 * import outside its own pure helper: every chunk a lazy module imports is listed for preload in
 * the startup chunk that loads it, and that list cost more bytes than the code it kept out.
 */
import type { UiSession } from '@/shared/api/contracts'
import type { DesktopUpdateApplyResult } from '@/shared/hooks/useDesktopUpdate'
import type { ConfirmableAction } from '@/shared/lib/confirmAction'
import type { toast } from '@/shared/lib/notify'
import { collectInterruptibleWork, describeInterruptibleWork } from './interruptibleWork'

export interface RestartToUpdateInput {
  apply: () => Promise<DesktopUpdateApplyResult>
  setBusy: (busy: boolean) => void
  roster: readonly UiSession[]
  confirm: (action: ConfirmableAction) => void
  notifyError: typeof toast.error
}

export async function runRestartToUpdate({
  apply,
  setBusy,
  roster,
  confirm,
  notifyError,
}: RestartToUpdateInput): Promise<void> {
  const install = async () => {
    setBusy(true)
    const result = await apply()
    // A successful install never returns — it relaunches. Reaching here means the update did
    // NOT happen, so the reason the shell gave is reported rather than swallowed.
    if (!result.ok) notifyError('Could not install the update', { description: result.error })
    setBusy(false)
  }

  const detail = describeInterruptibleWork(collectInterruptibleWork(roster))
  if (!detail) {
    await install()
    return
  }
  confirm({
    kind: 'restart-to-update',
    title: 'Restart to update now?',
    detail,
    confirmLabel: 'Restart and update',
    variant: 'destructive',
    perform: () => void install(),
  })
}
