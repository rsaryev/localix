import { useMemo, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import type { KanbanKind, KanbanTask } from '../../shared/contracts'
import { boardApi } from '../api/board-client'
import { acceptTask } from '../model/boardStore'

export type PriorityValue = -1 | 0 | 1

/**
 * All form state and actions for the full task-creation dialog, so the dialog stays a thin view
 * over this hook. The card goes on the board of the chat the dialog was opened from.
 */
export function useCreateTaskForm({
  sessionId,
  tasks,
  onClose,
}: {
  sessionId: string
  tasks: KanbanTask[]
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<KanbanKind>('task')
  const [ready, setReady] = useState(false)
  /** An agent id from the chat's directory; '' leaves the card unassigned. */
  const [agent, setAgent] = useState('')
  const [priority, setPriority] = useState<PriorityValue>(0)
  const [parentTaskId, setParentTaskId] = useState('')
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [attachedPaths, setAttachedPaths] = useState<string[]>([])
  const [pathDraft, setPathDraft] = useState('')
  const [depQuery, setDepQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Epics are containers and cannot depend on tasks, so candidates are leaf tasks only.
  const depCandidates = useMemo(
    () => tasks.filter((t) => t.kind !== 'epic').sort((a, b) => a.title.localeCompare(b.title)),
    [tasks],
  )
  const epicOptions = useMemo(
    () => tasks.filter((t) => t.kind === 'epic').sort((a, b) => a.title.localeCompare(b.title)),
    [tasks],
  )

  // Selected dependencies pinned first, then the query-filtered rest — so a long board stays
  // navigable and the current selection never scrolls out of view.
  const depFiltered = useMemo(() => {
    const q = depQuery.trim().toLowerCase()
    const matches = q
      ? depCandidates.filter(
          (t) => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
        )
      : depCandidates
    const selected = matches.filter((t) => dependsOn.includes(t.id))
    const rest = matches.filter((t) => !dependsOn.includes(t.id))
    return [...selected, ...rest]
  }, [depCandidates, depQuery, dependsOn])

  const addPaths = (paths: readonly string[]) =>
    setAttachedPaths((prev) => [...prev, ...paths.filter((p) => p && !prev.includes(p))])

  const addPath = () => {
    addPaths([pathDraft.trim()])
    setPathDraft('')
  }

  const removePath = (p: string) => setAttachedPaths((prev) => prev.filter((x) => x !== p))

  const toggleDep = (id: string) =>
    setDependsOn((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const browsePaths = async () => addPaths(await miniAppFiles.pickFiles())

  const submit = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    setError(null)
    const leaf = kind === 'task'
    try {
      const created = await boardApi.create(sessionId, {
        title: t,
        ...(description.trim() ? { description: description.trim() } : {}),
        kind,
        status: ready && leaf ? 'ready' : 'backlog',
        parentTaskId: leaf && parentTaskId ? parentTaskId : null,
        agent: agent || null,
        priority,
        ...(leaf && dependsOn.length ? { dependsOn } : {}),
        ...(attachedPaths.length ? { attachedPaths } : {}),
      })
      acceptTask(sessionId, created)
      onClose()
    } catch (e) {
      // Shown inline: the server's validation sentence IS the fix, so it stays.
      acknowledgeInline(e)
      setError(errorMessage(e, 'The task could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return {
    title,
    setTitle,
    description,
    setDescription,
    kind,
    setKind,
    ready,
    setReady,
    agent,
    setAgent,
    priority,
    setPriority,
    parentTaskId,
    setParentTaskId,
    dependsOn,
    attachedPaths,
    pathDraft,
    setPathDraft,
    depQuery,
    setDepQuery,
    busy,
    error,
    depCandidates,
    epicOptions,
    depFiltered,
    addPath,
    removePath,
    toggleDep,
    browsePaths,
    submit,
  }
}

export type CreateTaskForm = ReturnType<typeof useCreateTaskForm>
