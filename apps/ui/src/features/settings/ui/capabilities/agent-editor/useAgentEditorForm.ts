import { useState } from 'react'
import type { AgentRecordInput, AgentSummary } from '@/shared/api/contracts'
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
}

/**
 * Everything the agent form DECIDES, kept out of the markup: what the draft is, whether there
 * is anything to save, and what a save actually does. "Is this dirty?" matters because a submit
 * that is always live makes it possible to save an edit that was not one.
 */
export function useAgentEditorForm({ agent, initialHandle, onSave }: AgentEditorFormArgs) {
  const opened = agent
    ? draftFromRecord(agent.record)
    : { ...emptyAgentDraft(), name: initialHandle ?? '' }
  const [draft, setDraft] = useState(opened)
  /** Per-field problems. The pinned row below is for failures of the WHOLE save. */
  const [errors, setErrors] = useState<FieldErrors<AgentDraftField>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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

  const save = async () => {
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
    notice,
    errors,
    formError,
    save,
  }
}
