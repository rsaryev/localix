/**
 * Restart into a downloaded update, after saying what the restart will stop.
 *
 * The rail's update button and Settings → General → Updates both install through here, so the
 * warning cannot exist on one of them and be missing on the other. This is only the startup-side
 * stub: the rail renders it, the startup bundle is budgeted by `check:ui-startup`, and nothing
 * but the click needs the flow (`restartToUpdateFlow.ts`), so the flow is loaded then.
 *
 * The roster, the gate and the toast are read HERE and handed over, because they are already on
 * the startup path: a lazy module importing them would carry their preload list into this chunk.
 */
import { requestConfirmation } from '@/shared/lib/confirmAction'
import { toast } from '@/shared/lib/notify'
import type { DesktopUpdateApplyResult } from '@/shared/hooks/useDesktopUpdate'
import { getLiveSessionBody } from './sessionListHelpers'
import { useChatStore } from './store'

export async function restartToUpdate(
  apply: () => Promise<DesktopUpdateApplyResult>,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  // Every project's sessions, because a restart stops all of them; and a streaming session's
  // live body, which is fresher than its roster copy.
  const roster = useChatStore
    .getState()
    .allSessions.map((session) => getLiveSessionBody(session.id) ?? session)
  try {
    const { runRestartToUpdate } = await import('./restartToUpdateFlow')
    await runRestartToUpdate({
      apply,
      setBusy,
      roster,
      confirm: requestConfirmation,
      notifyError: toast.error,
    })
  } catch {
    // Without the flow the restart could cut off work unannounced — the failure this exists to
    // prevent — so it does not proceed.
    toast.error('Could not prepare the update')
  }
}
