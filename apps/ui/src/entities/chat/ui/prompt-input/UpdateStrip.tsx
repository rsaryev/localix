import { memo } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { useDesktopUpdate, type DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import { useBackgroundActivity } from '@/shared/lib/background-activity/useBackgroundActivity'
import { restartToUpdate } from '../../model/restartToUpdate'
import { storeApi } from '@/shared/api/store-client'
import { useStoreRecommendations } from '@/shared/hooks/useStoreRecommendations'
import {
  isUpdateOfferDismissed,
  useUpdateDismissals,
} from '@/shared/lib/background-activity/dismissals'
import { openStore } from '@/shared/lib/openStore'
import { useChatStore } from '../../model/store'
import { reportRecommendationsShown } from '@/shared/lib/recommendationEvents'
import { RecommendationsRow } from './RecommendationsRow'
import { UpdateOffersRow } from './UpdateOffersRow'

/**
 * The notice itself, with no state of its own: an available update with the one action it offers,
 * or the same row reporting an install in flight (the shell's live "Downloading update… N%").
 * While installing there is nothing to click and nothing to hide.
 */
export function UpdateRow({
  state,
  onInstall,
  onDismiss,
}: {
  state: DesktopUpdateState
  onInstall: () => void
  onDismiss: () => void
}) {
  if (state.installing) {
    return (
      <WorkbenchNoticeBar
        role="status"
        icon={<Spinner className="size-3.5" />}
        title="Updating"
        description={state.message}
      />
    )
  }
  return (
    <WorkbenchNoticeBar
      role="status"
      icon={<Download className="size-3.5" />}
      title="Update available"
      description={`Localix ${state.latestVersion} · you have ${state.currentVersion}`}
      actionsLabel="Update actions"
      actions={
        <Button type="button" variant="ghost" size="xs" className="font-normal" onClick={onInstall}>
          Restart to update
        </Button>
      }
      onDismiss={onDismiss}
      dismissLabel="Hide until the next version"
    />
  )
}

/**
 * A new version is ready: one quiet row above the composer, shown in a chat on screen (every warm
 * composer renders this stack; one behind another tab shows nothing), focused or not.
 * Pressing it goes through the same `restartToUpdate` as the rail and Settings, so a restart that
 * would cut off a running turn or a background job asks first and names what stops; with nothing
 * running the download starts at once. The rail's button owns the check and the progress listener;
 * this only reads their state.
 */
export const UpdateStrip = memo(function UpdateStrip({ isFocused }: { isFocused: boolean }) {
  // Only a composer on screen reads the offers: every warm composer renders this stack.
  return isFocused ? <FocusedUpdateStrip /> : null
})

/**
 * The app's own update always wins the strip and is always shown while it is available (it is
 * the only one that needs a restart); hidden, it gives the place to the other offers. Otherwise
 * the Store's updates are offered, every package kind together (`UpdateOffersRow`), and with none
 * to offer, what the Store recommends for the work (`RecommendationsRow`).
 */
function FocusedUpdateStrip() {
  const { state, applyUpdate, noticeDismissed, dismissNotice } = useDesktopUpdate({ poll: false })
  const { updates } = useBackgroundActivity()
  useUpdateDismissals()
  if (state?.available && (!noticeDismissed || state.installing)) {
    return (
      <UpdateRow
        state={state}
        onInstall={() => void restartToUpdate(applyUpdate, () => {})}
        onDismiss={dismissNotice}
      />
    )
  }
  if (updates.some((each) => each.id !== 'app' && !isUpdateOfferDismissed(each)))
    return <UpdateOffersRow offers={updates} />
  return <RecommendationsStrip />
}

/** The recommendations for the chat in focus and its project; nothing until they are worked out. */
function RecommendationsStrip() {
  const projectId = useChatStore((s) => s.activeProjectId ?? null)
  const sessionId = useChatStore((s) => s.activeSessionId)
  const answer = useStoreRecommendations(storeApi, projectId, sessionId)
  if (!answer.data) return null
  const reasons = answer.data.reasons
  return (
    <RecommendationsRow
      answer={answer.data}
      onSee={() => openStore({ recommended: true })}
      onShown={(named) => reportRecommendationsShown(storeApi, 'notice', named, reasons)}
    />
  )
}
