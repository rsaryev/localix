import { useMemo } from 'react'
import {
  VirtualDiff,
  buildDiffDocument,
  parseApplyPatch,
  parsePatchText,
  type DiffFileInput,
  type PatchFileSegment,
} from '@/shared/ui/diff'
import { ActivitySignal } from '@localixai/kit/activity-orb'

/**
 * Live, in-progress apply_patch stream — rendered as a CLEAN per-file diff instead of
 * the raw patch envelope. Splits the (possibly partial) patch text into its target
 * files and renders them through the SAME `VirtualDiff` the settled diff tab uses, so
 * the streaming view and the final view read identically, and a patch that writes a
 * large file stays one mounted window of rows instead of growing the DOM per line.
 */
function toFileInput(file: PatchFileSegment): DiffFileInput {
  // A body is one file's hunks; a mid-stream fragment without `@@` still types its lines.
  const hunks = file.body.trim() ? parsePatchText(file.body).flatMap((part) => part.hunks) : []
  return {
    path: file.path,
    hunks,
    added: file.kind === 'add',
    deleted: file.kind === 'delete',
    badge: file.kind === 'rename' ? 'rename' : undefined,
  }
}

export function LivePatchDiff({ code }: { code: string }) {
  const files = useMemo(() => parseApplyPatch(code), [code])
  const doc = useMemo(() => buildDiffDocument(files.map(toFileInput)), [files])

  if (!files.length) {
    return (
      <div className="flex min-h-24 items-center justify-center px-4 py-3 text-xs text-text-faint">
        <ActivitySignal label="Preparing changes" />
      </div>
    )
  }

  return (
    <VirtualDiff
      doc={doc}
      multiFile
      followTail
      collapseLarge={false}
      ariaLabel="Live patch"
      lead={<ActivitySignal label="Applying changes" className="text-2xs text-status-info" />}
      className="min-h-0 flex-1"
    />
  )
}
