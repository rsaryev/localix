import { GitCompare, FileText } from 'lucide-react'
import { mutationInputPaths, type FileChangeItem } from '@localixai/agent/agents'
import { inspector } from '@/shared/lib/inspectorBus'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { ToolLine } from '../ToolLine'
import { ErrorRow, ToolBody, ToolHeaderAction } from '../ToolIO'
import { isItemStreaming, hasItemError, itemErrorMessage } from '../itemHelpers'
import { baseName, strField, asRecord } from './format'
import { toolMeta } from './meta'
import { firstChangedLine } from '@/shared/ui/diff'
import { useSmoothedText } from '@/shared/hooks/useSmoothedText'
import { fileChangeSubtitle, lastContent, lastNewString } from './fileChangeFormat'
import { FileChangeRow } from './FileChangeRow'

/**
 * Rich card for `file_change` items (write / edit, and historical apply_patch items),
 * rendered over the normalized `changes[]` instead of per-tool details.
 *
 * While the model is still TYPING the arguments (`pending`), `item.input` holds
 * the PARTIAL parsed args — we derive live +/- counts from it and stream a
 * paced tail of the code being written below the row (like the old per-tool
 * parts did). Once done, the row shows per-file diffs with inspector actions.
 */
export function FileChangeCard({ item }: { item: FileChangeItem }) {
  // The chat whose transcript holds this card made the change, so Open/Diff land in ITS
  // workspace. Outside any chat there is no workspace to open into, and the actions are absent.
  const sessionId = useWorkItemSessionId()
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const errorMessage = itemErrorMessage(item)

  const input = asRecord(item.input)
  const isWrite = item.name === 'write'

  // Partial code currently being typed into the arguments (by tool shape): a batched `write`
  // types its last `files` entry, a batched `edit` its last `edits` entry; the top-level
  // fields are the single-file shape older items carry.
  const liveContent = strField(input, 'content') ?? lastContent(input?.files)
  const liveTarget = streaming
    ? isWrite
      ? liveContent
      : (strField(input, 'new_string') ?? lastNewString(input?.edits))
    : undefined
  // Paced reveal: bursty partial-JSON chunks → steady typewriter flow. Drives the
  // live +/- count + code tail in this card's subtitle below (inline only — never
  // an auto-opened workspace tab).
  const smoothedCode = useSmoothedText(liveTarget)

  // Partial multi-file change: some files applied, some failed — split so the failed
  // ones render as distinct error rows instead of fake successful changes.
  const appliedChanges = item.changes.filter((c) => !c.failed)
  const failedChanges = item.changes.filter((c) => c.failed)

  // ── Title ──────────────────────────────────────────────────────────────────
  const n = appliedChanges.length || item.changes.length
  const firstPath = (appliedChanges[0] ?? item.changes[0])?.path ?? mutationInputPaths(input)[0]
  const title =
    n > 1
      ? firstPath
        ? `${baseName(firstPath)} +${n - 1} more`
        : `${n} files`
      : firstPath
        ? baseName(firstPath)
        : item.name
  const titleDetails = n <= 1 ? firstPath : item.changes.map((c) => c.path).join('\n')

  // ── Subtitle ───────────────────────────────────────────────────────────────
  const subtitle = fileChangeSubtitle({
    streaming,
    isWrite,
    hasError,
    smoothedCode,
    rawContent: liveContent,
    edits: input?.edits,
    appliedChanges,
    failedChanges,
    status: item.status,
  })

  const changeKeyOccurrences = new Map<string, number>()
  const keyedChanges = item.changes.map((change) => {
    const base = `${change.path}:${change.kind}:${change.failed ? 'failed' : 'applied'}`
    const occurrence = (changeKeyOccurrences.get(base) ?? 0) + 1
    changeKeyOccurrences.set(base, occurrence)
    return {
      change,
      key: occurrence === 1 ? base : `${base}:duplicate-${occurrence}`,
    }
  })

  // No live workspace tab + no settled auto-reveal: an in-progress OR finished edit
  // never opens/switches a grid tab on its own. The live code preview stays inline
  // in this card's subtitle; OPENING the change is the user's call — the Open/Diff
  // header actions below.

  // Single file (the common case): the Open/Diff actions live in the header next
  // to the filename, so the row needs no body at all. Multi-file — or anything with
  // a failed file — keeps a list.
  const single = item.changes.length === 1 && !item.changes[0].failed ? item.changes[0] : null
  const headerActions =
    single && sessionId ? (
      <>
        {/* A deleted file is gone from disk — "Open" would 404, so offer only the diff
            (which still shows the removed contents). */}
        {single.kind !== 'delete' && (
          <ToolHeaderAction
            icon={FileText}
            label="Open"
            onClick={() =>
              inspector.openFile({
                sessionId,
                path: single.path,
                line: single.diff ? firstChangedLine(single.diff) : undefined,
              })
            }
          />
        )}
        {single.diff && (
          <ToolHeaderAction
            icon={GitCompare}
            label="Diff"
            onClick={() =>
              inspector.openDiff({
                sessionId,
                path: single.path,
                diff: single.diff!,
                title: baseName(single.path),
                deleted: single.kind === 'delete',
              })
            }
          />
        )}
      </>
    ) : undefined
  const showBody = item.changes.length > 1 || Boolean(errorMessage) || failedChanges.length > 0

  return (
    <>
      <ToolLine
        icon={toolMeta(item.name).icon}
        title={title}
        titleDetails={titleDetails}
        subtitle={subtitle}
        headerActions={headerActions}
        isLoading={streaming}
        hasError={hasError}
        // Opens only on failure, so the error rows remain visible. A multi-file diff list that
        // opened for the run and folded when it ended shut every such card at once, the
        // transcript's largest jump; the diff stat is on the row and the diffs are one click away.
        autoOpen={hasError}
      >
        {showBody && (
          <ToolBody>
            <ErrorRow message={errorMessage} />
            {keyedChanges.map(({ change, key }) => (
              <FileChangeRow key={key} change={change} />
            ))}
          </ToolBody>
        )}
      </ToolLine>
    </>
  )
}
