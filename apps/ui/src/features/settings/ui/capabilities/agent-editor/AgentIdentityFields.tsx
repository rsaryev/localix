import { MonogramAvatar } from '@localixai/kit/avatar'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import type { AgentField } from '@localixai/api/agent-policy'
import { AGENT_FIELD_IDS, type AgentDraft } from './agentDraft'

interface AgentIdentityFieldsProps {
  draft: AgentDraft
  /** True while editing: the handle is the record's identity and cannot change. */
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

/** Who the agent is: its handle, its title, its one-line description, and whether it is a bot. */
export function AgentIdentityFields({
  draft,
  editing,
  canEdit,
  patch,
  error,
}: AgentIdentityFieldsProps) {
  return (
    <>
      {/* Paired fields share one row; descriptions stay one line each so the two controls
          keep the same baseline (a wrapped description on one side used to push its
          control below its neighbour's). */}
      <div className="flex items-end gap-3">
        {/* The monogram is derived, never chosen, so the only way to know what it will look
            like is to watch it while the two fields it comes from are being typed. */}
        <MonogramAvatar identity={draft.name.trim()} label={draft.label} size={36} />
        <div className="grid flex-1 grid-cols-2 items-end gap-3 @max-md:grid-cols-1">
          <Field
            controlId={AGENT_FIELD_IDS.name}
            label="Name"
            description={
              editing
                ? 'Fixed once created — duplicate to rename.'
                : 'A handle: letters, digits, dashes.'
            }
            required
            error={error}
            readOnly={editing}
          >
            <Input
              size="xl"
              className="font-mono"
              placeholder="code-reviewer"
              value={draft.name}
              readOnly={editing}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field
            label="Title"
            description="Shown instead of the handle."
            optional
            readOnly={!canEdit('label')}
          >
            <Input
              size="xl"
              placeholder="Code Reviewer"
              value={draft.label}
              readOnly={!canEdit('label')}
              onChange={(e) => patch({ label: e.target.value })}
            />
          </Field>
        </div>
      </div>

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
