/**
 * The read behind a definition peek, owned one level above the peek itself.
 *
 * The panel used to fetch its own target and publish its own problem report. That is exactly the
 * shape `useProblemReport` cannot survive: the panel is mounted as `{peekTarget && <Panel/>}`, and
 * closing the peek — the NORMAL end of the condition — unmounts the only thing that could say the
 * problem is over. The Event Center kept asserting "this definition could not be read" for the rest
 * of the session.
 *
 * So the fetch lives here, called unconditionally by the tab with `target` possibly null. Null
 * settles the row; the panel becomes what it should always have been — a view of a result.
 */

import { useEffect, useState } from 'react'

import { backendClient } from '@/shared/api/client'
import { baseName, errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useProblemReport, type OwnedProblemReport } from '@/shared/ui/problem-report'

export interface PeekTarget {
  file: string
  /** 0-based line of the definition (LSP convention). */
  line: number
  /** 0-based column of the target token. */
  character?: number
}

export interface PeekDefinitionView {
  /** Target source, or null while it is still being read (or could not be). */
  content: string | null
  /** Bumped when content lands, so the read-only editor re-reveals the target line. */
  revealKey: number
  problem: OwnedProblemReport | null
}

/** Identity of one peek. State carries it so a previous target's result never paints a new one. */
const peekKey = (sessionId: string | null, target: PeekTarget | null) =>
  sessionId && target
    ? JSON.stringify([sessionId, target.file, target.line, target.character ?? null])
    : null

export function usePeekDefinition(
  sessionId: string | null,
  target: PeekTarget | null,
): PeekDefinitionView {
  const workItemVisible = useWorkItemVisible()
  const key = peekKey(sessionId, target)
  const [loaded, setLoaded] = useState<{ key: string; content: string } | null>(null)
  const [failed, setFailed] = useState<{ key: string; detail: string } | null>(null)
  const [revealKey, setRevealKey] = useState(0)

  const file = target?.file
  const line = target?.line
  const settled = loaded?.key === key || failed?.key === key
  useEffect(() => {
    if (!key || !sessionId || !file || !workItemVisible || settled) return
    let cancelled = false
    const controller = new AbortController()
    backendClient
      .getFileContent(sessionId, file, { full: true, signal: controller.signal })
      .then((res) => {
        if (cancelled) return
        setLoaded({ key, content: res.content })
        setRevealKey((k) => k + 1)
      })
      .catch((e: unknown) => {
        // `Cannot read /abs/path` is what the backend answers for every unreadable file. It is
        // the detail, not the sentence.
        if (!cancelled) setFailed({ key, detail: errorMessage(e, '') })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [key, sessionId, file, workItemVisible, settled])

  const problem = useProblemReport(
    failed?.key === key && file
      ? {
          subject: { label: baseName(file), path: file },
          problems: [
            {
              message: 'The file this definition lives in could not be read.',
              hint: 'It may have been moved or deleted since the index was built.',
              detail: failed.detail || undefined,
              // ProblemLocation is 1-indexed; the peek target is LSP 0-based.
              location: { path: file, line: (line ?? 0) + 1 },
            },
          ],
          consequence: 'blocked',
        }
      : null,
    { scope: 'editor', sourceVisible: workItemVisible },
  )

  return { content: loaded?.key === key ? loaded.content : null, revealKey, problem }
}
