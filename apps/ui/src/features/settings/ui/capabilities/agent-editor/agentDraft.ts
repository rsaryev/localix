import type { AgentRecord, AgentRecordInput } from '@/shared/api/contracts'
import { hasFieldErrors, type FieldErrors } from '@/shared/lib/forms/fieldErrors'

export interface AgentDraft {
  name: string
  label: string
  description: string

  provider: string

  model: string

  effort: string
  prompt: string

  maxTurns: string
  leadershipPriority: string
}

export const emptyAgentDraft = (): AgentDraft => ({
  name: '',
  label: '',
  description: '',
  provider: '',
  model: '',
  effort: '',
  prompt: '',
  maxTurns: '',
  leadershipPriority: '0',
})

export function draftFromRecord(record: AgentRecord): AgentDraft {
  return {
    name: record.handle,
    label: record.label ?? '',
    description: record.description ?? '',
    provider: record.modelPreference?.provider ?? '',
    model: record.modelPreference?.model ?? '',
    effort: record.modelPreference?.effort ?? '',
    prompt: record.instructions.trim(),
    maxTurns: record.limits?.maxTurns ? String(record.limits.maxTurns) : '',
    leadershipPriority: String(record.leadershipPriority),
  }
}

export function sameDraft(a: AgentDraft, b: AgentDraft): boolean {
  return (Object.keys(a) as Array<keyof AgentDraft>).every((key) => {
    const left = a[key]
    const right = b[key]
    return typeof left === 'string' && typeof right === 'string'
      ? left.trim() === right.trim()
      : left === right
  })
}

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]*(:[a-z0-9][a-z0-9_-]*)*$/i

/** The fields a reader can be sent to. Ids live in `AGENT_FIELD_IDS`. */
export type AgentDraftField = 'name' | 'prompt' | 'maxTurns' | 'leadershipPriority'

/** One id per validated control, shared by the `Field` that renders it and focus-on-submit. */
export const AGENT_FIELD_IDS = {
  name: 'agent-name',
  prompt: 'agent-instructions',
  maxTurns: 'agent-max-turns',
  leadershipPriority: 'agent-leadership-priority',
} as const satisfies Record<AgentDraftField, string>

export type DraftResult =
  | { ok: true; input: AgentRecordInput }
  | { ok: false; errors: FieldErrors<AgentDraftField> }

/**
 * Every problem at once, each against the field it belongs to, TOP-DOWN.
 *
 * It used to return on the first failure with one sentence for the whole form — so a draft
 * missing both a name and a prompt reported "Name and system prompt are required." as a
 * single line at the bottom, a reader fixed the name, pressed save, and met the next
 * sentence. The order here is the order the fields appear, which is what lets the submit
 * take the reader to the first one (`focusFirstInvalid`).
 */
export function draftToInput(draft: AgentDraft, existing?: AgentRecord): DraftResult {
  const name = draft.name.trim()
  const prompt = draft.prompt.trim()
  const maxTurns = draft.maxTurns.trim() ? Number(draft.maxTurns) : undefined
  const leadershipPriority = Number(draft.leadershipPriority)
  const errors: FieldErrors<AgentDraftField> = {}
  if (!name) errors.name = 'Required.'
  else if (!AGENT_NAME_RE.test(name)) {
    errors.name = 'Letters, digits, dashes or underscores — like code-reviewer.'
  }
  // Required for EVERY agent, shipped ones included. A system agent used to be allowed to
  // save an empty persona, stored as a single space to slip past the wire schema's `min(1)`
  // — and an agent with no system prompt is an agent with no identity, which is not a state
  // the editor should be able to produce. Restore is how the shipped text comes back.
  if (!prompt) errors.prompt = 'Required — an agent with no instructions has no identity.'
  if (maxTurns !== undefined && (!Number.isInteger(maxTurns) || maxTurns <= 0)) {
    errors.maxTurns = 'A whole number above zero, or blank for unlimited.'
  }
  if (!Number.isInteger(leadershipPriority) || leadershipPriority < -2 || leadershipPriority > 2) {
    errors.leadershipPriority = 'Choose a whole number from −2 to 2.'
  }
  if (hasFieldErrors(errors)) return { ok: false, errors }
  const model = draft.model.trim()
  const provider = draft.provider.trim()
  const effort = draft.effort.trim()
  const input: AgentRecordInput = {
    handle: name,
    instructions: prompt,
    leadershipPriority,
    description: draft.description.trim(),
    ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
    ...(model || effort
      ? {
          modelPreference: {
            ...(model ? { model } : {}),
            ...(model && provider ? { provider } : {}),
            ...(effort ? { effort } : {}),
          },
        }
      : {}),
    ...(maxTurns ? { limits: { maxTurns } } : {}),
    ...(existing?.context ? { context: existing.context } : {}),
  }
  return { ok: true, input }
}
