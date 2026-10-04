import type { ReactNode } from 'react'
import { agentPolicy, canEditField, type AgentField } from '@localixai/api/agent-policy'
import type { AgentRecord, AgentRecordInput, AgentSummary } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Textarea } from '@localixai/kit/textarea'
import { SettingsRecordPage } from '../../SettingsRecordPage'
import { AgentModelField } from './AgentModelField'
import { AgentIdentityFields } from './AgentIdentityFields'
import { useAgentEditorForm } from './useAgentEditorForm'
import { AGENT_FIELD_IDS } from './agentDraft'

interface AgentEditorProps {
  /** Present when editing; absent when creating. */
  agent?: AgentSummary
  /** Name of the agent currently being mutated, used to disable the submit. */
  busy: string | null
  onSave: (input: AgentRecordInput) => Promise<void>
  onCancel: () => void
  /**
   * Read the definition this installation SHIPS for this agent. It fills the fields and
   * nothing else: restoring defaults is an edit the user then reviews and saves, not a write
   * that happens under the click — there was nothing on screen to confirm it before.
   */
  onLoadDefaults?: () => Promise<AgentRecord>
  /**
   * Remove the user's override, which is what SAVING restored defaults means: writing the
   * shipped text back as an override would leave the agent marked customized forever.
   */
  onDropOverride?: () => Promise<void>
}

/**
 * The agent's DEFINITION — four sections: who it is, what it runs on, what it says, and how far
 * it may go. The same form creates and edits, and the same form edits an agent imported from
 * another tool or a system agent: the record is one schema, so the form is one form. Its
 * decisions — dirty, defaults, what a save does — are `useAgentEditorForm`; what is left here is
 * the shape on screen.
 *
 * It draws NO heading and offers no verb that acts on the record: it is one tab of the profile
 * that already names the agent above it, and a second name under that one would be the profile
 * introducing itself twice. What the agent MAY USE is the profile's other tabs, next to this
 * one, for the same reason — this form is what the record SAYS, and that is a ceiling composed
 * with the installation's and the project's.
 */
export function AgentEditor({
  agent,
  busy,
  onSave,
  onCancel,
  onLoadDefaults,
  onDropOverride,
}: AgentEditorProps) {
  const form = useAgentEditorForm({ agent, onSave, onLoadDefaults, onDropOverride })
  const { draft, patch } = form
  const editing = Boolean(agent)
  // One table, read here and enforced by `updateAgent`. A new agent has no class yet, so
  // everything is open until it exists.
  const policy = agent ? agentPolicy(agent) : null
  const canEdit = (field: AgentField) => !policy || canEditField(policy, field)
  const saving = busy !== null && busy === (agent?.record.id ?? draft.name.trim())

  return (
    <SettingsRecordPage
      busy={saving}
      busyLabel={editing ? 'Saving agent' : 'Creating agent'}
      submitLabel={
        form.backToDefaults && onDropOverride
          ? 'Save defaults'
          : editing
            ? 'Save changes'
            : 'Create agent'
      }
      submitDisabled={!form.dirty}
      error={form.formError}
      notice={form.notice}
      // Restore stands with Cancel and Save because it is about THIS form — it fills the
      // fields back in — and it is offered only while the form still differs from what the
      // app ships. Nothing to restore, nothing on screen.
      extraAction={
        form.canRestore ? (
          <Button variant="ghost" onClick={form.restore} disabled={saving}>
            Restore
          </Button>
        ) : undefined
      }
      onSubmit={() => void form.save()}
      onCancel={onCancel}
    >
      <Section title="Identity">
        <AgentIdentityFields
          draft={draft}
          editing={editing}
          canEdit={canEdit}
          patch={patch}
          error={form.errors.name}
        />
      </Section>

      <Section title="Model">
        <AgentModelField
          provider={draft.provider}
          model={draft.model}
          effort={draft.effort}
          disabled={!canEdit('model')}
          onChange={(next) => patch(next)}
          onEffortChange={(effort) => patch({ effort })}
        />
      </Section>

      <Section title="Instructions">
        <Field
          controlId={AGENT_FIELD_IDS.prompt}
          label="Instructions"
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
      </Section>

      <Section title="Limits">
        <div className="grid grid-cols-2 items-end gap-3 @max-md:grid-cols-1">
          <Field
            controlId={AGENT_FIELD_IDS.leadershipPriority}
            label="Hierarchy priority"
            description="Elects the leader in group sessions. −2 support, 0 regular, 2 lead. Explicit routing still wins."
            error={form.errors.leadershipPriority}
            readOnly={!canEdit('leadershipPriority')}
          >
            <Input
              size="xl"
              type="number"
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
            description="Tool batches before a run stops."
            optional
            error={form.errors.maxTurns}
            readOnly={!canEdit('maxTurns')}
          >
            <Input
              size="xl"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="Unlimited"
              value={draft.maxTurns}
              readOnly={!canEdit('maxTurns')}
              onChange={(e) => patch({ maxTurns: e.target.value })}
            />
          </Field>
        </div>
      </Section>
    </SettingsRecordPage>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-text-faint">{title}</h3>
      {children}
    </section>
  )
}
