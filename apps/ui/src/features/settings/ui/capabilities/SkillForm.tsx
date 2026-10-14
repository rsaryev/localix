import { useState } from 'react'
import { backendClient } from '@/shared/api/client'
import type { Project, SkillInput } from '@/shared/api/contracts'
import { buildProjectScopeOptions } from '@/shared/lib/projectScope'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { Textarea } from '@localixai/kit/textarea'
import { inlineFailure } from '@/shared/lib/notifications/inlineReport'
import { SettingsRecordEditor } from '../SettingsRecordEditor'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { focusFirstInvalid, hasFieldErrors, type FieldErrors } from '@/shared/lib/forms/fieldErrors'

type SkillField = 'name' | 'description' | 'content'

/** One id per validated control — read by its `Field` and by focus-on-submit. */
const SKILL_FIELD_IDS = {
  name: 'skill-name',
  description: 'skill-description',
  content: 'skill-content',
} as const satisfies Record<SkillField, string>

/** Blank draft for a new skill in `projectId` ('' scope → null = no project). */
export const emptySkillDraft = (projectId: string | null): SkillInput => ({
  name: '',
  description: '',
  content: '',
  projectId,
})

/**
 * The create/edit dialog for a SKILL.md.
 *
 * Its draft and its `formError` live here rather than in the tab: a rejected
 * name is a fact about these fields, and hoisting it next to the list's load
 * error is how a typo starts looking like the skills registry went down. The tab
 * decides WHICH skill is being edited; everything about editing it is here.
 */
export function SkillForm({
  initial,
  projects,
  onSaved,
  onCancel,
}: {
  /** Prefilled draft — blank for a new skill, the record's fields for an edit. */
  initial: SkillInput
  projects: Project[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<SkillInput>(initial)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<SkillField>>({})
  const [formError, setFormError] = useState<string | null>(null)

  /** Edit a field and stop complaining about it; see `fieldErrors.ts`. */
  const edit = (next: Partial<SkillInput>, field?: SkillField) => {
    if (field) setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
    setDraft((prev) => ({ ...prev, ...next }))
  }

  const save = async () => {
    // Top-down, one message per field, all of them at once — the reader used to fix the
    // name, press save, and only then learn the description was missing too.
    const found: FieldErrors<SkillField> = {}
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(draft.name)) {
      found.name = draft.name.trim() ? 'Letters, numbers, dashes or underscores.' : 'Required.'
    }
    if (!draft.description.trim()) found.description = 'Required.'
    if (!draft.content.trim()) found.content = 'Required — this is what the skill does.'
    if (hasFieldErrors(found)) {
      setErrors(found)
      setFormError(null)
      focusFirstInvalid(found, SKILL_FIELD_IDS)
      return
    }
    setSaving(true)
    setErrors({})
    setFormError(null)
    try {
      await trackCapabilityWrite(undefined, () => backendClient.createSkill(draft))
      onSaved()
    } catch (e) {
      setFormError(inlineFailure(e, 'This skill could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsRecordEditor
      title={initial.name ? `Edit /${initial.name}` : 'New skill'}
      description="A procedure the agent can run by name, stored as a SKILL.md."
      busy={saving}
      busyLabel="Saving skill"
      submitLabel="Save skill"
      error={formError}
      onSubmit={() => void save()}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
        <Field controlId={SKILL_FIELD_IDS.name} label="Name" required error={errors.name}>
          <Input
            size="xl"
            placeholder="deploy-staging"
            value={draft.name}
            onChange={(e) => edit({ name: e.target.value }, 'name')}
          />
        </Field>
        <Field label="Scope">
          <Select
            size="xl"
            className="w-full"
            value={draft.projectId ?? ''}
            onValueChange={(v) => setDraft({ ...draft, projectId: v || null })}
            options={buildProjectScopeOptions(projects)}
          />
        </Field>
      </div>
      <Field
        controlId={SKILL_FIELD_IDS.description}
        label="Description"
        required
        error={errors.description}
      >
        <Input
          size="xl"
          placeholder="Deploy the app to staging"
          value={draft.description}
          onChange={(e) => edit({ description: e.target.value }, 'description')}
        />
      </Field>
      <Field
        controlId={SKILL_FIELD_IDS.content}
        label="Instructions"
        description="Use $ARGUMENTS for input passed after the command."
        required
        error={errors.content}
      >
        <Textarea
          size="xl"
          className="min-h-30 resize-y font-mono"
          placeholder={'Run the deploy script for $ARGUMENTS and report the result.'}
          value={draft.content}
          onChange={(e) => edit({ content: e.target.value }, 'content')}
        />
      </Field>
    </SettingsRecordEditor>
  )
}
