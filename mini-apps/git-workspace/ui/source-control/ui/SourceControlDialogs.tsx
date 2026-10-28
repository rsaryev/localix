import { useCallback, useId, useState, type ReactNode } from 'react'
import { Flame } from 'lucide-react'
import type { RepoStash } from '../../../backend/source-control/contracts'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { Checkbox } from '@localixai/kit/checkbox'
import { Button } from '@localixai/kit/button'
import type { DiscardRequest } from '../model/changeActions'
import { guardGit } from '../model/gitFailure'
import { useSourceControlStore } from '../model/store'

export interface SourceControlConfirms {
  /** Ask before discarding (destructive); the answer runs against the repo the request names. */
  requestDiscard: (request: DiscardRequest) => void
  requestStashDrop: (stash: RepoStash) => void
  /** Open the nuke confirmation (its "also remove untracked" box starts unchecked). */
  requestNuke: () => void
  /** The three dialogs, to render once in the panel. */
  dialogs: ReactNode
}

/**
 * The Source Control panel's three destructive confirmations — discard, stash drop and nuke —
 * with the state that holds each pending request. Every one of them used to be spelled inline in
 * the tab, which made the tab the owner of three unrelated dialogs' state on top of its layout.
 */
export function useSourceControlConfirms(
  sessionId: string | null,
  nuke: (removeUntracked: boolean) => Promise<void>,
): SourceControlConfirms {
  const [pendingDiscard, setPendingDiscard] = useState<DiscardRequest | null>(null)
  const [pendingStashDrop, setPendingStashDrop] = useState<RepoStash | null>(null)
  const [nukeOpen, setNukeOpen] = useState(false)
  const [nukeUntracked, setNukeUntracked] = useState(false)
  const nukeUntrackedId = useId()
  const store = useSourceControlStore.getState()

  const confirmDiscard = () => {
    if (!sessionId || !pendingDiscard) return
    const { paths, repoRoot } = pendingDiscard
    setPendingDiscard(null)
    void guardGit('Could not discard changes', () => store.discard(sessionId, paths, repoRoot))
  }

  const confirmStashDrop = () => {
    if (!sessionId || !pendingStashDrop) return
    const { index } = pendingStashDrop
    setPendingStashDrop(null)
    void guardGit('Could not drop the stash', () => store.dropStash(sessionId, index))
  }

  const confirmNuke = () => {
    setNukeOpen(false)
    void nuke(nukeUntracked)
  }

  const requestNuke = useCallback(() => {
    setNukeUntracked(false)
    setNukeOpen(true)
  }, [])

  const dialogs = (
    <>
      <ConfirmDialog
        open={pendingDiscard !== null}
        variant="destructive"
        title="Discard changes?"
        description={
          pendingDiscard
            ? `Discard unstaged changes in "${pendingDiscard.label}"? This restores tracked files to their staged version and deletes selected untracked files. Staged changes are kept — discarded edits cannot be undone.`
            : ''
        }
        confirmLabel="Discard"
        onConfirm={confirmDiscard}
        onClose={() => setPendingDiscard(null)}
      />

      <ConfirmDialog
        open={pendingStashDrop !== null}
        variant="destructive"
        title="Drop stash?"
        description={
          pendingStashDrop
            ? `Discard the stash "${pendingStashDrop.message}"? Its changes are removed without being restored — this cannot be undone.`
            : ''
        }
        confirmLabel="Drop"
        onConfirm={confirmStashDrop}
        onClose={() => setPendingStashDrop(null)}
      />

      {/* Nuke — always confirmed; the checkbox opts into removing untracked files too. */}
      <Dialog
        open={nukeOpen}
        onOpenChange={(v) => {
          if (!v) setNukeOpen(false)
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-status-error">
              <Flame className="size-4" /> Nuke the working tree?
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <p className="text-sm leading-relaxed text-text-soft">
              Discard ALL uncommitted changes — tracked files are restored to the last commit. This
              cannot be undone.
            </p>
            <label
              htmlFor={nukeUntrackedId}
              className="flex items-center gap-2 text-xs text-text-soft"
            >
              <Checkbox
                id={nukeUntrackedId}
                checked={nukeUntracked}
                onChange={(e) => setNukeUntracked(e.target.checked)}
              />
              Also remove untracked files (keeps ignored build/dependency dirs)
            </label>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              size="xl"
              className="rounded-lg text-text-soft"
              onClick={() => setNukeOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive-solid"
              size="xl"
              className="rounded-lg"
              onClick={() => confirmNuke()}
            >
              Nuke changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return {
    requestDiscard: setPendingDiscard,
    requestStashDrop: setPendingStashDrop,
    requestNuke,
    dialogs,
  }
}
