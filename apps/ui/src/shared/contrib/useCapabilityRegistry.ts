import { useCallback, useEffect, useState } from 'react'

import type { CapabilitySnapshot } from '@/shared/api/contracts'
import { useCapabilitySnapshot } from '@/shared/contrib/useCapabilitySnapshot'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'

/**
 * One registry list, projected from the scope's capability document.
 *
 * The plugin, agent and MCP-server lists are the same hook three times:
 * read a field of the document, paint an optimistic row while a switch is in flight,
 * and drop that overlay the moment a newer document arrives. Writing it four times made
 * them agree by coincidence — a fix to one (say, forgetting to clear the overlay) would
 * not reach the other three.
 *
 * `select` is the only thing that differs, so it is the only thing a caller passes.
 */
export interface CapabilityRegistry<T> {
  /** The rows to render — the document's, or the optimistic overlay over them. */
  rows: T[]
  /** True until this scope has a document; loading is a property of the document. */
  loading: boolean
  /** The document's own load failure. Mutation failures belong to the caller. */
  error: string | null
  /** Paint an optimistic change. Dropped as soon as a fresh document lands. */
  overlay: (update: (current: T[]) => T[]) => void
  /** Re-read this scope now (a manual retry). */
  refresh: () => void
  /** Run a mutation, reverting the overlay and returning a sentence if it fails. */
  mutate: (run: () => Promise<unknown>, failureMessage: string) => Promise<string | null>
}

export function useCapabilityRegistry<T>(
  scope: string,
  select: (snapshot: CapabilitySnapshot) => T[],
): CapabilityRegistry<T> {
  const workItemVisible = useWorkItemVisible()
  const capabilities = useCapabilitySnapshot(scope, workItemVisible)
  const [optimistic, setOptimistic] = useState<T[] | null>(null)

  const document = capabilities.snapshot
  const rows = document ? select(document) : []

  // The server's answer always wins: a new document supersedes whatever was painted
  // ahead of it, including an overlay that turned out to be wrong.
  useEffect(() => {
    setOptimistic(null)
  }, [document])

  const overlay = useCallback(
    (update: (current: T[]) => T[]) => setOptimistic((current) => update(current ?? rows)),
    // `rows` is read only as the base for the FIRST overlay of a document; taking it as
    // a dependency would rebuild this callback on every render of a list that renders
    // on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [document],
  )

  const mutate = useCallback(async (run: () => Promise<unknown>, failureMessage: string) => {
    try {
      await run()
      return null
    } catch (error) {
      setOptimistic(null)
      // Every caller puts this sentence on the list's own error line, so it is the report.
      return inlineFailure(error, failureMessage)
    }
  }, [])

  return {
    rows: optimistic ?? rows,
    loading: capabilities.loading,
    error: capabilities.error,
    overlay,
    refresh: capabilities.refresh,
    mutate,
  }
}
