import { agentPolicy, canEditField, type AgentField } from '@localixai/api/agent-policy'
import type { AgentRecordInput, AgentSummary } from '@/shared/api/contracts'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { SettingsRecordPage } from '../../SettingsRecordPage'
import { SettingsSection } from '../../SettingsScaffold'
import { SettingsFieldGrid } from '../../SettingsFieldGrid'
import { AgentModelField } from './AgentModelField'
import { AgentIdentityFields } from './AgentIdentityFields'
import { AgentContextFields } from './AgentContextFields'
import { useAgentEditorForm } from './useAgentEditorForm'
import { AGENT_FIELD_IDS } from './agentDraft'
import { clampMaxTurns } from '@localixai/api/turn-budget'
import { useSettingsStore } from '@/shared/lib/user-settings/settingsStore'

interface AgentEditorProps {
  /** Present when editing; absent when creating. */
  agent?: AgentSummary
  initialHandle?: string
  /** Name of the agent currently being mutated, used to disable the submit. */
  busy: string | null
  onSave: (input: AgentRecordInput) => Promise<void>
  onCancel: () => void
}

/**
 * The agent's DEFINITION — four sections: who it is, what it runs on, what it says, and how far
 * it may go. The same form creates and edits,. Its
 * decisions — dirty, what a save does — are `useAgentEditorForm`; what is left here is
 * the shape on screen.
 *
 * It draws NO heading and offers no verb that acts on the record: it is one tab of the profile
 * that already names the agent above it, and a second name under that one would be the profile
 * introducing itself twice. What the agent MAY USE is the profile's other tabs, next to this
 * one, for the same reason — this form is what the record SAYS, and that is a ceiling composed
 * with the installation's and the project's.
 */
export function AgentEditor({ agent, initialHandle, busy, onSave, onCancel }: AgentEditorProps) {
  const form = useAgentEditorForm({ agent, initialHandle, onSave })
  const { draft, patch } = form
  const editing = Boolean(agent)
  // One table, read here and enforced by `updateAgent`. A new agent has no class yet, so
  // everything is open until it exists.
  const policy = agent ? agentPolicy(agent) : null
  const canEdit = (field: AgentField) => !policy || canEditField(policy, field)
  const saving = busy !== null && busy === (agent?.record.id ?? draft.name.trim())
  const userLimit = useSettingsStore((state) => state.settings.agentSettings.maxTurns)
  const inheritedLimit = clampMaxTurns(userLimit)
  const authoredLimit = Number(draft.maxTurns)
  const effectiveLimit =
    Number.isInteger(authoredLimit) && authoredLimit > 0
      ? Math.min(inheritedLimit, authoredLimit)
      : inheritedLimit

  return (
    <SettingsRecordPage
      busy={saving}
      busyLabel={editing ? 'Saving agent' : 'Creating agent'}
      submitLabel={editing ? 'Save changes' : 'Create agent'}
      submitDisabled={!form.dirty}
      error={form.formError}
      notice={form.notice}
      onSubmit={() => void form.save()}
      onCancel={onCancel}
    >
      <SettingsSection title="Identity">
        <AgentIdentityFields
          draft={draft}
          editing={editing}
          canEdit={canEdit}
          patch={patch}
          error={form.errors.name}
        />
      </SettingsSection>

      <SettingsSection title="Model">
        <AgentModelField
          provider={draft.provider}
          model={draft.model}
          effort={draft.effort}
          disabled={!canEdit('model')}
          effortError={form.errors.effort}
          onChange={(next) => patch(next)}
          onEffortChange={(effort) => patch({ effort })}
        />
      </SettingsSection>

      <SettingsSection title="Instructions">
        <Field
          controlId={AGENT_FIELD_IDS.prompt}
          label="Standing instructions"
          description="The agent’s identity and standing instructions. Markdown."
          required
          error={form.errors.prompt}
          readOnly={!canEdit('prompt')}
        >
          <Textarea
            size="xl"
            className="min-h-40 resize-y"
            placeholder="You are a meticulous code reviewer. You…"
            value={draft.prompt}
            readOnly={!canEdit('prompt')}
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </Field>
      </SettingsSection>

      <SettingsSection title="Context">
        <AgentContextFields draft={draft} patch={patch} readOnly={!canEdit('context')} />
      </SettingsSection>

      <SettingsSection title="Limits">
        <SettingsFieldGrid columnsAt="2xl">
          <Field
            controlId={AGENT_FIELD_IDS.leadershipPriority}
            label="Hierarchy priority"
            required
            description="Elects the leader in group sessions. −2 support, 0 regular, 2 lead. Explicit routing still wins."
            error={form.errors.leadershipPriority}
            readOnly={!canEdit('leadershipPriority')}
          >
            <Input
              size="xl"
              type="number"
              required
              inputMode="numeric"
              min={-2}
              max={2}
              step={1}
              value={draft.leadershipPriority}
              readOnly={!canEdit('leadershipPriority')}
              onChange={(e) => patch({ leadershipPriority: e.target.value })}
            />
          </Field>
          <Field
            controlId={AGENT_FIELD_IDS.maxTurns}
            label="Max turns"
            description={`Tool batches before a run stops. Blank inherits ${inheritedLimit}. Effective maximum: ${effectiveLimit}; a delegated task may impose a lower cap.`}
            optional
            error={form.errors.maxTurns}
            readOnly={!canEdit('maxTurns')}
          >
            <Input
              size="xl"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="Inherit run limit"
              value={draft.maxTurns}
              readOnly={!canEdit('maxTurns')}
              onChange={(e) => patch({ maxTurns: e.target.value })}
            />
          </Field>
        </SettingsFieldGrid>
      </SettingsSection>
    </SettingsRecordPage>
  )
}
