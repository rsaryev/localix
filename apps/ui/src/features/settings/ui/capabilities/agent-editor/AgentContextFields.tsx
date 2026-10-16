import { Field } from '@localixai/kit/field'
import { Textarea } from '@localixai/kit/textarea'
import { Select } from '@localixai/kit/select'
import { SettingsFieldGrid } from '../../SettingsFieldGrid'
import type { AgentDraft } from './agentDraft'

const MEMORY_OPTIONS = [
  { value: 'inherit', label: 'All available scopes' },
  { value: 'session', label: 'This conversation only' },
  { value: 'project', label: 'This project only' },
  { value: 'global', label: 'Global notes only' },
]

export function AgentContextFields({
  draft,
  readOnly,
  patch,
}: {
  draft: AgentDraft
  readOnly: boolean
  patch: (next: Partial<AgentDraft>) => void
}) {
  return (
    <SettingsFieldGrid columnsAt="2xl">
      <Field
        controlId="agent-preload-skills"
        label="Preloaded skills"
        optional
        readOnly={readOnly}
        description="One skill name per line. Loaded for chats and delegated work, subject to permission rules."
      >
        <Textarea
          size="xl"
          className="min-h-24 resize-y"
          value={draft.preloadSkills}
          readOnly={readOnly}
          placeholder="review-conventions"
          onChange={(event) => patch({ preloadSkills: event.target.value })}
        />
      </Field>
      <Field
        controlId="agent-memory-scope"
        label="Memory scope"
        disabled={readOnly}
        description="Controls where notes are read and saved. All scopes includes conversation, project and global notes."
      >
        <Select
          size="xl"
          value={draft.memoryScope}
          options={MEMORY_OPTIONS}
          disabled={readOnly}
          onValueChange={(value) => {
            if (MEMORY_OPTIONS.some((option) => option.value === value)) {
              patch({ memoryScope: value as AgentDraft['memoryScope'] })
            }
          }}
        />
      </Field>
    </SettingsFieldGrid>
  )
}
