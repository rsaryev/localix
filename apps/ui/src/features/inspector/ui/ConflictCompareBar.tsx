import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { toast } from '@/shared/lib/notify'
import { backendClient } from '@/shared/api/client'
import { baseName } from '@localixai/plugin-sdk/ui/utilities'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import type { DiffConflictActions } from '@/shared/lib/inspectorBus'
import { applySaveCleanup, getSaveCleanupPrefs } from '@/shared/ui/code-editor/saveCleanup'
import { publishConflictResolved } from './conflictResolvedBus'
import { Button } from '@localixai/kit/button'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'

/**
 * Header bar for the conflict `compare` tab (disk ⟷ your edits): lets the user
 * apply a resolution directly from the comparison instead of returning to the
 * editor's reconcile banner. Reuses the SAME write path the banner's Overwrite uses
 * (`writeFileContent` echoing the disk hash) — no new write semantics — and signals
 * any open editor of the file to adopt the winning side. Rendered by the diff tab
 * shell above the untouched generic `DiffView`.
 */
export function ConflictCompareBar({
  ctx,
  onDone,
}: {
  ctx: DiffConflictActions
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const name = baseName(ctx.editPath)

  // Keep my edits: apply the editor's enabled save cleanups, then overwrite the
  // on-disk version with those exact bytes while echoing the fresh disk hash (a
  // deliberate, user-confirmed clobber — identical to the banner action).
  const keepMine = async () => {
    setBusy(true)
    try {
      const content = applySaveCleanup(ctx.edits, getSaveCleanupPrefs())
      const res = await backendClient.writeFileContent(
        ctx.sessionId,
        ctx.editPath,
        content,
        ctx.diskHash,
      )
      publishConflictResolved({
        sessionId: ctx.sessionId,
        editPath: ctx.editPath,
        expectedBuffer: ctx.edits,
        content,
        hash: res.hash,
      })
      // No success row: the compare tab closes and the editor adopts the result where it was clicked.
      onDone()
    } catch (err) {
      toast.error(`Could not overwrite “${name}” with your edits`, {
        description: errorMessage(err, '') || undefined,
      })
      setBusy(false)
    }
  }

  // Take disk version: discard the local edits and adopt what's on disk. Disk
  // already holds this content, so nothing is written — just signal the editor to
  // adopt it (mirrors the banner's "Discard & reload").
  const takeDisk = () => {
    publishConflictResolved({
      sessionId: ctx.sessionId,
      editPath: ctx.editPath,
      expectedBuffer: ctx.edits,
      content: ctx.diskContent,
      hash: ctx.diskHash,
    })
    onDone()
  }

  return (
    <WorkbenchNoticeBar
      role="alert"
      tone="warning"
      icon={<TriangleAlert className="size-3.5" />}
      title={`Reconcile ${name}:`}
      actionsLabel="Conflict resolution actions"
      actions={
        <>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void keepMine()}>
            Keep my edits (overwrite disk)
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={takeDisk}>
            Take disk version (discard mine)
          </Button>
        </>
      }
    />
  )
}
