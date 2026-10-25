import { MonogramAvatar } from '@localixai/kit/avatar'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import type { AgentField } from '@localixai/api/agent-policy'
import { SettingsFieldGrid } from '../../SettingsFieldGrid'
import { AGENT_FIELD_IDS, type AgentDraft } from './agentDraft'

interface AgentIdentityFieldsProps {
  draft: AgentDraft
  /** True for an existing definition; policy decides whether its handle may change. */
  editing: boolean
  /**
   * What this agent's class allows, from the ONE policy table the server guards with. A
   * control the server would refuse is read-only here rather than live-and-then-refused.
   */
  canEdit: (field: AgentField) => boolean
  patch: (next: Partial<AgentDraft>) => void
  /** What is wrong with the handle, shown under it. Absent = nothing is. */
  error?: string
}

/** Who the agent is: its handle and its one-line description. */
export function AgentIdentityFields({
  draft,
  editing,
  canEdit,
  patch,
  error,
}: AgentIdentityFieldsProps) {
  const nameLocked = editing && !canEdit('name')
  return (
    <>
      <SettingsFieldGrid columnsAt="2xl">
        <Field
          controlId={AGENT_FIELD_IDS.name}
          label="Name"
          description={
            nameLocked
              ? 'This handle is owned by the app or extension.'
              : editing
                ? 'Renaming preserves this agent’s ID and permission rules.'
                : 'A handle: letters, digits, dashes.'
          }
          required
          error={error}
          readOnly={nameLocked}
        >
          <div className="flex min-w-0 items-center gap-3">
            <MonogramAvatar identity={draft.name.trim()} size={36} />
            <Input
              size="xl"
              className="min-w-0 flex-1 font-mono"
              placeholder="code-reviewer"
              value={draft.name}
              readOnly={nameLocked}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
        </Field>
      </SettingsFieldGrid>

      <Field
        label="Description"
        description="One line on what this agent is good at; rosters and routing read it."
        optional
        readOnly={!canEdit('description')}
      >
        <Input
          size="xl"
          placeholder="Reviews diffs for correctness and style"
          value={draft.description}
          readOnly={!canEdit('description')}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </Field>
    </>
  )
}
