import { useCallback, useRef, useState } from 'react'
import { z } from 'zod'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { resumeSchema, type Resume, type ResumeDocument } from '../shared/schema'
import { draftSchema } from '../shared/draft-schema'
import { editHistory, redoHistory, startHistory, undoHistory, type EditHistory } from './history'

const recoverySchema = z.strictObject({ base: resumeSchema, draft: draftSchema })
const key = (id: string) => `resume.draft.v1.${id}`
interface DraftState {
  base: Resume
  history: EditHistory<ResumeDocument>
  recovered: boolean
}

/** Local recovery and history never masquerade as a server save or advance a revision. */
export function useResumeDraft() {
  const [state, setState] = useState<DraftState | null>(null)
  const latest = useRef(state)
  const publish = useCallback((next: DraftState | null) => {
    latest.current = next
    setState(next)
    if (next)
      saveJSON(
        key(next.base.id),
        JSON.stringify(next.base.document) === JSON.stringify(next.history.value)
          ? null
          : { base: next.base, draft: next.history.value },
      )
  }, [])
  const adopt = useCallback(
    (resume: Resume, recover = false) => {
      const recovery = recover ? recoverySchema.safeParse(loadJSON(key(resume.id))) : null
      if (recovery?.success && recovery.data.base.id === resume.id) {
        publish({
          base: recovery.data.base,
          history: startHistory(recovery.data.draft),
          recovered: true,
        })
      } else publish({ base: resume, history: startHistory(resume.document), recovered: false })
    },
    [publish],
  )
  const clear = useCallback(() => {
    const current = latest.current
    if (current) saveJSON(key(current.base.id), null)
    publish(null)
  }, [publish])
  const setDraft = (document: ResumeDocument, group = true) => {
    const current = latest.current
    if (current)
      publish({ ...current, history: editHistory(current.history, document, Date.now(), group) })
  }
  const dirty = Boolean(
    state && JSON.stringify(state.base.document) !== JSON.stringify(state.history.value),
  )
  return {
    base: state?.base ?? null,
    draft: state?.history.value ?? null,
    dirty,
    latest,
    recovered: state?.recovered ?? false,
    canUndo: Boolean(state?.history.past.length),
    canRedo: Boolean(state?.history.future.length),
    adopt,
    setDraft,
    clear,
    undo: () => {
      const current = latest.current
      if (current) publish({ ...current, history: undoHistory(current.history) })
    },
    redo: () => {
      const current = latest.current
      if (current) publish({ ...current, history: redoHistory(current.history) })
    },
    rebase: (resume: Resume, document: ResumeDocument) =>
      publish({ base: resume, history: startHistory(document), recovered: false }),
  }
}
