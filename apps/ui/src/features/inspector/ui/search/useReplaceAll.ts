/**
 * Replace-all for the content search: one project-wide rewrite at a time, reported once.
 *
 * Its own hook because it guards a different failure than the search does. The search can be
 * superseded freely; a rewrite cannot be taken back, so a second click while one is in flight
 * joins the first instead of rewriting the files twice, stale hits from an older query never
 * authorize it (`ready`), and a rewrite that finishes after its session's panel moved on stays
 * silent rather than toasting into another chat (`owner`).
 */
import { useCallback, useRef, useState, type RefObject } from 'react'
import { toast } from '@/shared/lib/notify'
import { backendClient } from '@/shared/api/client'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useActionFeedback, type ActionFeedbackStore } from '@localixai/kit/action-feedback'

/** The search criteria a replacement must use — the same ones the visible hits were found by. */
export interface ReplaceCriteria {
  regex: boolean
  caseSensitive: boolean
  wholeWord: boolean
  includeGlob: string
  excludeGlob: string
  includeIgnored: boolean
}

export function useReplaceAll({
  sessionId,
  query,
  replaceText,
  criteria,
  ready,
  owner,
  onReplaced,
}: {
  sessionId: string | null
  /** The trimmed search query. */
  query: string
  replaceText: string
  criteria: ReplaceCriteria
  /** The visible hits belong to the CURRENT criteria — nothing else may authorize a rewrite. */
  ready: boolean
  /** Flips inactive when the panel's session or mount is replaced. */
  owner: RefObject<{ active: boolean }>
  /** Re-run the search so the list reflects the rewritten files. */
  onReplaced: () => void
}): { replacing: boolean; runReplace: () => Promise<void>; feedback: ActionFeedbackStore } {
  const [replacing, setReplacing] = useState(false)
  const feedback = useActionFeedback()
  const flightRef = useRef<Promise<void> | null>(null)
  const { regex, caseSensitive, wholeWord, includeGlob, excludeGlob, includeIgnored } = criteria

  const runReplace = useCallback((): Promise<void> => {
    if (flightRef.current) return flightRef.current
    if (!sessionId || !query || !ready) return Promise.resolve()

    const current = owner.current
    const owned = () => current.active
    const options = {
      regex,
      caseSensitive,
      wholeWord,
      glob: includeGlob.trim() || undefined,
      excludeGlob: excludeGlob.trim() || undefined,
      includeIgnored,
    }
    setReplacing(true)
    const flight = backendClient
      .replaceContent(sessionId, query, replaceText, options)
      .then((res) => {
        if (!owned()) return
        // Said beside the replace field the person used, not as a journal row: the count is the
        // answer to their click, and the files it touched are already on screen in the results.
        // Nothing replaced is no success.
        const n = res.replacements
        const files = `${res.filesChanged} file${res.filesChanged === 1 ? '' : 's'}`
        if (n === 0) feedback.show(`No occurrences of “${query}” were replaced`)
        else
          feedback.show(`Replaced ${n} occurrence${n === 1 ? '' : 's'} in ${files}`, {
            tone: 'success',
          })
        onReplaced()
      })
      .catch((err: unknown) => {
        if (owned())
          toast.error(`Could not replace “${query}” across the project`, {
            description: errorMessage(err, '') || undefined,
          })
      })
      .finally(() => {
        if (flightRef.current === flight) flightRef.current = null
        if (owned()) setReplacing(false)
      })
    flightRef.current = flight
    return flight
  }, [
    sessionId,
    query,
    replaceText,
    regex,
    caseSensitive,
    wholeWord,
    includeGlob,
    excludeGlob,
    includeIgnored,
    ready,
    owner,
    onReplaced,
    feedback,
  ])

  return { replacing, runReplace, feedback }
}
