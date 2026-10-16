import { Plus } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { Field } from '@localixai/kit/field'
import { emptyEntry, type ResumeSection } from '../shared/schema'
import { ValidationScope, useFieldError } from './validation'
import { TextField } from './TextField'
import { EntryEditor } from './EntryEditor'
import { ChoiceMenu } from './ChoiceMenu'
import { byRecency } from '../shared/order'

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
  const richOnly = section.type === 'custom' && section.variant === 'rich'
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
        {['skills', 'languages'].includes(section.type) && (
          <>
            <Field label="Columns">
              <ChoiceMenu
                label={`${section.columns ?? 2} columns`}
                entries={([1, 2] as const).map((columns) => ({
                  id: String(columns),
                  label: `${columns} column${columns === 1 ? '' : 's'}`,
                  selected: (section.columns ?? 2) === columns,
                  onSelect: () => onChange({ ...section, columns }),
                }))}
              />
            </Field>
            <Field label="Show proficiency" layout="inline">
              <Checkbox
                checked={section.showProficiency ?? true}
                onChange={(event) =>
                  onChange({ ...section, showProficiency: event.target.checked })
                }
              />
            </Field>
          </>
        )}
        {['experience', 'internship', 'projects', 'organizations', 'education'].includes(
          section.type,
        ) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...section, entries: [...section.entries].sort(byRecency) })}
          >
            Sort newest first
          </Button>
        )}
      </div>
      {section.entries.map((entry, index) => (
        <ValidationScope key={entry.id} prefix={`entries.${index}`}>
          <EntryEditor
            richOnly={richOnly}
            disabled={disabled}
            entry={entry}
            type={section.type}
            index={index}
            count={section.entries.length}
            onChange={(value) => {
              const entries = section.entries.map((item) => (item.id === value.id ? value : item))
              const dated =
                (entry.start !== value.start ||
                  entry.end !== value.end ||
                  entry.current !== value.current) &&
                [value.start, value.end].every((date) => /^(?:|\d{4}(?:-\d{2})?)$/u.test(date))
              onChange({
                ...section,
                entries: dated && !disabled ? entries.sort(byRecency) : entries,
              })
            }}
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
        disabled={section.entries.length >= (section.type === 'summary' || richOnly ? 1 : 60)}
        onClick={() => onChange({ ...section, entries: [...section.entries, emptyEntry()] })}
      >
        <Plus data-icon="inline-start" />
        Add entry
      </Button>
    </div>
  )
}
