import { Button } from '@localixai/kit/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import type { DesktopUpdateState } from '@/shared/hooks/useDesktopUpdate'
import { ReleaseNotes } from './ReleaseNotes'
import { UpdateScene } from './UpdateScene'

/**
 * A new version, announced: the scene draws the update arriving, the copy names both versions,
 * and the feed's release notes follow when it has any. Any way of closing it is "Later".
 */
export default function UpdateDialog({
  state,
  onLater,
  onInstall,
}: {
  state: DesktopUpdateState
  onLater: () => void
  onInstall: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onLater()
      }}
    >
      {/* Bounded, whatever the notes' length: the scene, the versions and the actions stay put,
          and only the notes scroll — in the one viewport the dialog has, never a box inside it. */}
      <DialogContent size="md" className="max-h-[min(40rem,calc(100dvh-2rem))]">
        <UpdateScene from={state.currentVersion} to={state.latestVersion ?? ''} />
        {/* Centred under the stage, like every confirmation: the notes below stay a list. */}
        <DialogHeader className="pr-4 text-center [&>[data-slot=dialog-header-main]]:items-center">
          <DialogTitle>Localix {state.latestVersion} is ready</DialogTitle>
          <DialogDescription className="text-balance">
            You have {state.currentVersion}. Restarting downloads and installs the update; if a chat
            or a background job is still running, you are asked first.
          </DialogDescription>
        </DialogHeader>
        {state.notes ? (
          <DialogBody className="border-t border-border-soft pt-3">
            <section aria-label="What’s new" className="flex flex-col gap-2">
              <h3 className="text-2xs font-medium tracking-wide text-text-faint uppercase">
                What’s new
              </h3>
              <ReleaseNotes markdown={state.notes} />
            </section>
          </DialogBody>
        ) : null}
        <DialogFooter actionsLabel="Update actions">
          <Button variant="ghost" className="text-text-soft" onClick={onLater}>
            Later
          </Button>
          <Button variant="mono" onClick={onInstall}>
            Restart to update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
