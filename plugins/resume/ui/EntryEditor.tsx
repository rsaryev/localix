import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Checkbox } from '@localixai/kit/checkbox'
import { Field } from '@localixai/kit/field'
import { RichTextEditor } from '@localixai/kit/rich-text'
import { sectionDefinitions, type EntryField } from '../shared/sections'
import type { ResumeEntry, SectionType } from '../shared/schema'
import { TextField } from './TextField'
import { useFieldError } from './validation'

export function EntryEditor({
  entry,
  type,
  index,
  count,
  onChange,
  onRemove,
  onMove,
  disabled = false,
}: {
  entry: ResumeEntry
  type: SectionType
  index: number
  count: number
  onChange: (entry: ResumeEntry) => void
  onRemove: () => void
  onMove: (index: number) => void
  disabled?: boolean
}) {
  const definition = sectionDefinitions[type]
  const bodyError = useFieldError('body')
  const set = (key: EntryField, value: string) => onChange({ ...entry, [key]: value })
  const labels: Record<EntryField, string> = {
    title: definition.titleLabel ?? 'Title',
    organization: definition.organizationLabel ?? 'Organization',
    location: 'Location',
    start: 'Start date',
    end: 'End date',
    body: 'Description',
    bullets: 'Achievements',
  }
  return (
    <section aria-label={`Entry ${index + 1}`} className="space-y-4 border-t border-border py-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-medium">
          {entry.title || `Entry ${index + 1}`}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            aria-label={`Move entry ${index + 1} up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            aria-label={`Move entry ${index + 1} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown />
          </IconButton>
          <IconButton aria-label={`Remove entry ${index + 1}`} onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </div>
      </div>
      <div className="grid gap-4 @xl:grid-cols-2">
        {definition.fields
          .filter((key) => key !== 'bullets' && key !== 'body' && key !== 'start' && key !== 'end')
          .map((key) => (
            <TextField
              key={key}
              field={key}
              label={labels[key]}
              value={entry[key] as string}
              onChange={(value) => set(key, value)}
            />
          ))}
      </div>
      {definition.fields.includes('start') && (
        <div className="grid grid-cols-2 gap-4">
          <TextField
            field="start"
            label="Start date"
            value={entry.start}
            placeholder="YYYY or YYYY-MM"
            onChange={(value) => set('start', value)}
          />
          <TextField
            field="end"
            label="End date"
            value={entry.end}
            placeholder={entry.current ? 'Present' : 'YYYY or YYYY-MM'}
            disabled={entry.current}
            onChange={(end) => onChange({ ...entry, end, current: end ? false : entry.current })}
          />
        </div>
      )}
      {definition.fields.includes('end') && (
        <Field label="Current position or ongoing activity" layout="inline">
          <Checkbox
            checked={entry.current}
            onChange={(event) =>
              onChange({
                ...entry,
                current: event.target.checked,
                end: event.target.checked ? '' : entry.end,
              })
            }
          />
        </Field>
      )}
      {definition.fields.includes('body') && (
        <Field label={labels.body} error={bodyError} disabled={disabled}>
          <RichTextEditor
            value={entry.body}
            maxLength={8_000}
            onChange={(body) => onChange({ ...entry, body })}
          />
        </Field>
      )}
      {definition.fields.includes('bullets') && (
        <div className="space-y-3">
          {entry.bullets.map((bullet, i) => (
            <div key={i} className="flex items-end gap-2">
              <TextField
                field={`bullets.${i}`}
                label={`Achievement ${i + 1}`}
                value={bullet}
                multiline
                maxLength={2_000}
                onChange={(value) =>
                  onChange({
                    ...entry,
                    bullets: entry.bullets.map((item, j) => (j === i ? value : item)),
                  })
                }
              />
              <IconButton
                aria-label={`Remove achievement ${i + 1}`}
                onClick={() =>
                  onChange({ ...entry, bullets: entry.bullets.filter((_, j) => j !== i) })
                }
              >
                <Trash2 />
              </IconButton>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={entry.bullets.length >= 30}
            onClick={() => onChange({ ...entry, bullets: [...entry.bullets, ''] })}
          >
            <Plus data-icon="inline-start" />
            Add achievement
          </Button>
        </div>
      )}
      {type !== 'summary' && type !== 'skills' && type !== 'languages' && (
        <div className="space-y-3">
          {entry.link ? (
            <>
              <TextField
                field="link.label"
                label="Link label"
                value={entry.link.label}
                onChange={(label) => onChange({ ...entry, link: { ...entry.link!, label } })}
              />
              <TextField
                field="link.url"
                label="Link URL"
                value={entry.link.url}
                maxLength={2_000}
                placeholder="https://example.com"
                onChange={(url) => onChange({ ...entry, link: { ...entry.link!, url } })}
              />
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...entry, link: null })}>
                Remove link
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...entry, link: { label: '', url: '' } })}
            >
              Add reference link
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
