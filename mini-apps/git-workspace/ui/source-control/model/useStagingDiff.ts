import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildDiffDocument, type DiffDocument, type DiffLineInput } from '@localixai/kit/diff'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type {
  FileDiffLines,
  LineStageMode,
  RepoDiffLine,
} from '../../../backend/source-control/contracts'
import { sourceControlApi } from '../../api'
import { sourceControlFileStamp, useSourceControlStore } from './store'
import { gitFailed } from './gitFailure'

export type StagingOp = 'stage' | 'unstage' | 'discard'

const TYPE: Record<Exclude<RepoDiffLine['kind'], 'hunk'>, DiffLineInput['type']> = {
  context: 'ctx',
  add: 'add',
  del: 'del',
}

/**
 * The fetched, raw-index-keyed staging lines as a host diff document. Each line's
 * `key` is its raw-diff index — the exact value the stage/unstage/discard endpoints
 * take back — so a change run of the document IS a block op's payload.
 */
export function stagingDocument(data: FileDiffLines): DiffDocument {
  const hunks: { header: string; lines: DiffLineInput[] }[] = []
  for (const line of data.lines) {
    if (line.kind === 'hunk') {
      hunks.push({ header: line.content, lines: [] })
      continue
    }
    // A body line before any `@@` is malformed input; there is no hunk to anchor it to.
    hunks[hunks.length - 1]?.lines.push({
      type: TYPE[line.kind],
      text: line.content,
      oldNo: line.oldNo,
      newNo: line.newNo,
      key: line.index,
    })
  }
  return buildDiffDocument([{ path: data.path, hunks }])
}

/** Raw-diff indices of the change lines in `[start, end)` of a document. */
export function changeKeys(doc: DiffDocument, start = 0, end = doc.lines.length): number[] {
  const keys: number[] = []
  for (let id = start; id < end; id++) {
    const line = doc.lines[id]!
    if ((line.type === 'add' || line.type === 'del') && line.key !== undefined) keys.push(line.key)
  }
  return keys
}

/**
 * Fetch → re-fetch → operate for one file's staging diff.
 *
 * Two defects shaped it. A view that only fetched on mount showed a stale diff after
 * the file changed ELSEWHERE (editor gutter revert, the changes tree, the poller
 * after a save) — so it watches the file's scoped status stamp. And an op that
 * reloaded explicitly AND let the stamp effect reload fetched every diff twice — so
 * after an op the new stamp is recorded as already seen before the one reload.
 */
export function useStagingDiff(input: {
  sessionId: string
  path: string
  mode: LineStageMode
  repoRoot?: string
}) {
  const { sessionId, path, mode, repoRoot } = input
  const visible = useWorkItemVisible()
  const [data, setData] = useState<FileDiffLines | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const request = useRef(0)
  const stampSeen = useRef<string | null>(null)
  const stampOf = useCallback(
    () =>
      sourceControlFileStamp(useSourceControlStore.getState().bySession[sessionId], path, repoRoot),
    [sessionId, path, repoRoot],
  )
  const fileStamp = useSourceControlStore((s) =>
    sourceControlFileStamp(s.bySession[sessionId], path, repoRoot),
  )

  // Returns a cancel: a superseded or unmounted request must not land. The generation
  // check covers a NEWER load overtaking an older one; the flag covers unmount and hide.
  const load = useCallback(() => {
    const id = ++request.current
    let cancelled = false
    const current = () => !cancelled && id === request.current
    sourceControlApi
      .getFileDiffLines(sessionId, path, mode, repoRoot)
      .then((next) => {
        if (!current()) return
        setData(next)
        setLoading(false)
      })
      .catch((err) => {
        if (!current()) return
        gitFailed('Could not load the diff', err)
        setData(null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, path, mode, repoRoot])

  useEffect(() => {
    if (!visible) {
      stampSeen.current = null
      return
    }
    stampSeen.current = stampOf()
    return load()
  }, [load, visible, stampOf])

  useEffect(() => {
    if (!visible || stampSeen.current === null || stampSeen.current === fileStamp) return
    stampSeen.current = fileStamp
    return load()
  }, [fileStamp, load, visible])

  const doc = useMemo(() => (data ? stagingDocument(data) : null), [data])

  const run = useCallback(
    async (op: StagingOp, lines: number[]) => {
      if (!data || lines.length === 0 || busy) return
      const store = useSourceControlStore.getState()
      setBusy(true)
      try {
        const call =
          op === 'stage'
            ? store.stageLines(sessionId, path, lines, data.diffId, repoRoot)
            : op === 'unstage'
              ? store.unstageLines(sessionId, path, lines, data.diffId, repoRoot)
              : store.discardLines(sessionId, path, lines, data.diffId, repoRoot)
        await call
      } catch (err) {
        // A 409 stale-diff rejection is recoverable only with a fresh diffId, so the
        // reload below runs on failure too.
        gitFailed(`Could not ${op} the block`, err)
      } finally {
        stampSeen.current = stampOf()
        load()
        setBusy(false)
      }
    },
    [data, busy, sessionId, path, repoRoot, stampOf, load],
  )

  return { data, doc, loading, busy, run }
}
