import { WorkItemSlot } from '@/shared/contrib/WorkItemSlot'
import { useWorkItemSlot } from '@/shared/contrib/workItemSlots'
import { useCallback, useMemo } from 'react'
import { FileText, TriangleAlert } from 'lucide-react'
import type { WorkItem } from '@/shared/lib/workItem'
import { groupOfTab, sessionOfScope, useGridStore } from '@/entities/workspace-grid/model'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { ConflictCompareBar } from '@/features/inspector/ui/ConflictCompareBar'
import type { DiffConflictActions, DiffProvenanceRequest } from '@/shared/lib/inspectorBus'
import {
  DiffStat,
  VirtualDiff,
  diffDocumentFromPatch,
  type DiffDocument,
  type DocFile,
} from '@/shared/ui/diff'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { Button } from '@localixai/kit/button'

function payload<T = unknown>(item: WorkItem, key: string): T | undefined {
  return item.payload?.[key] as T | undefined
}

function closeWorkItem(itemId: string): void {
  const state = useGridStore.getState()
  const leaf = groupOfTab(state.root, itemId)
  if (leaf) state.closeTab(leaf.id, itemId)
}

/** Opens the file in the diff tab's OWN chat (`sessionId`, from its scope); a diff tab that
 *  belongs to no chat has nowhere to open it, so the action is not rendered. */
function OpenFileAction({
  sessionId,
  path,
  line,
}: {
  sessionId: string | null
  path: string
  line?: number
}) {
  if (!sessionId) return null
  const label = line == null ? `Open ${path}` : `Open ${path} at line ${line}`
  return (
    <ActionTooltip label={label}>
      <Button
        variant="ghost"
        size="xs"
        aria-label={label}
        onClick={() => openFileInGrid({ sessionId, path, line })}
        className="shrink-0 text-text-soft hover:text-foreground"
      >
        <FileText className="size-3.5" aria-hidden="true" />
        Open file
      </Button>
    </ActionTooltip>
  )
}

/** The producer stopped reading at its byte cap: say so, rather than let a prefix pass for the whole. */
function TruncatedNotice({ doc }: { doc: DiffDocument }) {
  return (
    <WorkbenchNoticeBar
      tone="warning"
      icon={<TriangleAlert className="size-3.5" />}
      title="Diff truncated"
      description={`Too large to load in full — showing the first ${doc.files.length.toLocaleString()} ${doc.files.length === 1 ? 'file' : 'files'}.`}
    />
  )
}

function DiffLead({ doc, multiFile }: { doc: DiffDocument; multiFile: boolean }) {
  const count = doc.files.length
  return (
    <>
      {multiFile && (
        <span>
          {count.toLocaleString()} {count === 1 ? 'file' : 'files'} changed
        </span>
      )}
      <DiffStat additions={doc.additions} deletions={doc.deletions} />
    </>
  )
}

/**
 * The complete diff work-item body. It lives behind the grid's panel-local
 * Suspense boundary so diff parsing, syntax highlighting, staging, and conflict
 * UI do not enter the first-chat startup graph.
 */
export function DiffWorkItemBody({ item }: { item: WorkItem }) {
  const interactive = useWorkItemSlot('diff.interactive')
  const sessionId = sessionOfScope(item.scope)
  const provenance = payload<DiffProvenanceRequest>(item, 'provenance')
  const conflict = payload<DiffConflictActions>(item, 'conflict')
  const diff = payload<string>(item, 'diff') ?? ''
  const rootPath = payload<string>(item, 'rootPath')
  const path = payload<string>(item, 'path')
  const languagePath = payload<string>(item, 'languagePath')
  const truncated = payload<boolean>(item, 'truncated') === true
  const doc = useMemo(() => diffDocumentFromPatch(diff), [diff])
  // A "single-file" payload that carries several files still reads per file, with headers.
  const multiFile = payload<boolean>(item, 'multiFile') === true || doc.files.length > 1

  const toAbsolute = useCallback(
    (file: DocFile) => (rootPath ? `${rootPath.replace(/\/$/, '')}/${file.path}` : undefined),
    [rootPath],
  )
  const singleLink = languagePath ?? path
  const linkPath = useCallback(
    (file: DocFile) => (file.deleted ? undefined : multiFile ? toAbsolute(file) : singleLink),
    [multiFile, toAbsolute, singleLink],
  )
  const fileActions = useCallback(
    (file: DocFile) => {
      const target = file.deleted ? undefined : toAbsolute(file)
      return target ? (
        <OpenFileAction sessionId={sessionId} path={target} line={file.firstLine} />
      ) : null
    },
    [sessionId, toAbsolute],
  )

  // OPAQUE. What a line can be staged into, and what the two sides are called, belongs to whoever
  // fills the slot — the host only knows there is a value to hand over.
  const staging = payload<unknown>(item, 'staging')
  // Interactive staging is contributed, not built in: the host owns the slot and the payload, the
  // plugin that owns git renders it. The slot is empty when no plugin fills it (yet), so a
  // staging descriptor with no owner falls through to the ordinary read-only diff below.
  if (!multiFile && staging && interactive) {
    return <WorkItemSlot slot="diff.interactive" item={item} value={staging} />
  }

  const openablePath =
    !multiFile && !languagePath && !conflict && !payload<boolean>(item, 'deleted')
      ? path
      : undefined

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkItemSlot slot="diff.provenance" item={item} value={provenance} />
      {conflict && <ConflictCompareBar ctx={conflict} onDone={() => closeWorkItem(item.id)} />}
      <VirtualDiff
        doc={doc}
        multiFile={multiFile}
        languagePath={multiFile ? undefined : singleLink}
        linkPath={linkPath}
        fileActions={multiFile ? fileActions : undefined}
        lead={<DiffLead doc={doc} multiFile={multiFile} />}
        notice={truncated ? <TruncatedNotice doc={doc} /> : undefined}
        actions={
          openablePath && (
            <OpenFileAction
              sessionId={sessionId}
              path={openablePath}
              line={doc.files[0]?.firstLine}
            />
          )
        }
        className="min-h-0 flex-1"
      />
    </div>
  )
}
