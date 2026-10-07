import { Plus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { Field } from '@localixai/kit/field'
import { emptyEntry, type ResumeSection } from '../shared/schema'
import { ValidationScope, useFieldError } from './validation'
import { TextField } from './TextField'
import { EntryEditor } from './EntryEditor'

export function SectionEditor({
  section,
  onChange,
  disabled = false,
}: {
  section: ResumeSection
  onChange: (section: ResumeSection) => void
  disabled?: boolean
}) {
  const entriesError = useFieldError('entries')
  return (
    <div>
      <div className="space-y-4 pb-5">
        <TextField
          field="title"
          label="Section heading"
          value={section.title}
          onChange={(title) => onChange({ ...section, title })}
        />
        <Field label="Include in exported resume" layout="inline">
          <Checkbox
            checked={!section.hidden}
            onChange={(event) => onChange({ ...section, hidden: !event.target.checked })}
          />
        </Field>
        {section.hidden && (
          <p className="text-xs text-text-soft">
            Retained in the core and JSON export. Hidden in the preview, text and Markdown.
          </p>
        )}
      </div>
      {section.entries.map((entry, index) => (
        <ValidationScope key={entry.id} prefix={`entries.${index}`}>
          <EntryEditor
            disabled={disabled}
            entry={entry}
            type={section.type}
            index={index}
            count={section.entries.length}
            onChange={(value) =>
              onChange({
                ...section,
                entries: section.entries.map((item) => (item.id === value.id ? value : item)),
              })
            }
            onRemove={() =>
              onChange({
                ...section,
                entries: section.entries.filter((item) => item.id !== entry.id),
              })
            }
            onMove={(target) => {
              const entries = [...section.entries]
              entries.splice(index, 1)
              entries.splice(target, 0, entry)
              onChange({ ...section, entries })
            }}
          />
        </ValidationScope>
      ))}
      {entriesError && (
        <p role="alert" className="my-3 text-xs text-status-error">
          {entriesError}
        </p>
      )}
      <Button
        variant="field"
        size="sm"
        disabled={section.entries.length >= (section.type === 'summary' ? 1 : 60)}
        onClick={() => onChange({ ...section, entries: [...section.entries, emptyEntry()] })}
      >
        <Plus data-icon="inline-start" />
        Add entry
      </Button>
    </div>
  )
}
