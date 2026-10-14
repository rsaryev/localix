import { useEffect, useRef, useState } from 'react'
import type { AgentRecord, AgentRecordInput, AgentSummary } from '@/shared/api/contracts'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { focusFirstInvalid, type FieldErrors } from '@/shared/lib/forms/fieldErrors'
import {
  AGENT_FIELD_IDS,
  draftFromRecord,
  draftToInput,
  emptyAgentDraft,
  sameDraft,
  type AgentDraft,
  type AgentDraftField,
} from './agentDraft'

export interface AgentEditorFormArgs {
  agent?: AgentSummary
  initialHandle?: string
  onSave: (input: AgentRecordInput) => Promise<void>
  /** Read the shipped definition. Absent for anything this installation does not ship. */
  onLoadDefaults?: () => Promise<AgentRecord>
  /** Remove the user's override — what SAVING a restored draft means. */
  onDropOverride?: () => Promise<void>
}

/**
 * Everything the agent form DECIDES, kept out of the markup: what the draft is, whether there
 * is anything to save, what the shipped defaults are, and what a save actually does.
 *
 * The two questions it answers are the ones the dialog used to get wrong. "Is this dirty?" —
 * the submit was always live, so it was possible to save an edit that was not one. And "what
 * are the defaults?" — restoring them used to be a WRITE under the click, with nothing on
 * screen to review; here they are read once when the form opens, offered only while the form
 * differs from them, and applied to the fields so the user is the one who saves.
 */
export function useAgentEditorForm({
  agent,
  initialHandle,
  onSave,
  onLoadDefaults,
  onDropOverride,
}: AgentEditorFormArgs) {
  const opened = agent
    ? draftFromRecord(agent.record)
    : { ...emptyAgentDraft(), name: initialHandle ?? '' }
  const [draft, setDraft] = useState(opened)
  /** Per-field problems. The pinned row below is for failures of the WHOLE save. */
  const [errors, setErrors] = useState<FieldErrors<AgentDraftField>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [defaults, setDefaults] = useState<AgentDraft | null>(null)

  // Keyed by the agent, not by the loader: the parent passes a fresh closure on every render,
  // and depending on THAT identity would mean one request per keystroke. A failed read simply
  // leaves Restore out — it is not this edit's problem to report.
  const loader = useRef(onLoadDefaults)
  loader.current = onLoadDefaults
  useEffect(() => {
    const load = loader.current
    if (!load) return
    let live = true
    void load()
      .then((record) => {
        if (live) setDefaults(draftFromRecord(record))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [agent?.record.id])

  const patch = (next: Partial<AgentDraft>) => {
    setNotice(null)
    // A field being corrected stops complaining as it is typed. The alternative — holding
    // the message until the next submit — leaves a red line under a field the reader has
    // already fixed, which teaches them to ignore it. The other fields keep theirs: nothing
    // was said about those yet.
    setErrors((prev) => {
      const touched = Object.keys(next) as Array<keyof AgentDraft>
      if (!touched.some((field) => prev[field as AgentDraftField])) return prev
      const cleared = { ...prev }
      for (const field of touched) delete cleared[field as AgentDraftField]
      return cleared
    })
    setDraft((prev) => ({ ...prev, ...next }))
  }

  // A submit that can only be a no-op is a button that lies about having done something.
  const dirty = !sameDraft(draft, opened)
  const backToDefaults = Boolean(defaults && sameDraft(draft, defaults))

  const restore = () => {
    if (!defaults) return
    setDraft(defaults)
    setErrors({})
    setFormError(null)
    setNotice('Defaults filled in. Review them, then save.')
  }

  const save = async () => {
    // Saving a draft that is exactly what the app ships REMOVES the override rather than
    // writing a copy of it — otherwise the agent stays marked as customized forever.
    if (backToDefaults && onDropOverride) {
      setFormError(null)
      try {
        await onDropOverride()
      } catch (cause) {
        setFormError(inlineFailure(cause, 'The defaults could not be restored.'))
      }
      return
    }
    const result = draftToInput(draft, agent?.record)
    if (!result.ok) {
      // Per field, beside the control — and the reader is taken to the first one, which is
      // the only thing the old pinned summary did better than silence.
      setErrors(result.errors)
      setFormError(null)
      focusFirstInvalid(result.errors, AGENT_FIELD_IDS)
      return
    }
    setErrors({})
    setFormError(null)
    try {
      await onSave(result.input)
    } catch (cause) {
      setFormError(inlineFailure(cause, 'This agent could not be saved.'))
    }
  }

  return {
    draft,
    patch,
    dirty,
    backToDefaults,
    /** There is a shipped definition AND this form is not already it. */
    canRestore: Boolean(defaults) && !backToDefaults,
    restore,
    notice,
    errors,
    formError,
    save,
  }
}
