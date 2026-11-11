import { useMemo, useState, type KeyboardEvent } from 'react'
import type { McpElicitationSchema } from '@localixai/api/client'
import {
  elicitationFieldProblems,
  elicitationFormFields,
  type ElicitationField,
  type ElicitationValue,
} from '@rsaryev/llx-plugin/elicitation'
import { Checkbox } from '@localixai/kit/checkbox'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'

/**
 * THE FORM OF AN MCP ELICITATION: one control per field of the server's flat schema, as the kit
 * reads it (`elicitationFormFields`), checked by the kit's rule (`elicitationFieldProblems`), the
 * same one the server side applies, so what Submit sends is what the server accepts. The card
 * around it owns the frame, the footer and the deadline.
 */

type Draft = string | boolean | string[]

function initialDraft(field: ElicitationField): Draft {
  if (field.type === 'boolean') return typeof field.default === 'boolean' ? field.default : false
  if (field.type === 'multi-enum') return Array.isArray(field.default) ? field.default : []
  return field.default === undefined || Array.isArray(field.default) ? '' : String(field.default)
}

/** A typed draft as the protocol value it stands for; an empty optional answer is left out. */
function fieldValue(field: ElicitationField, draft: Draft): ElicitationValue | undefined {
  if (field.type === 'boolean') return draft
  if (field.type === 'multi-enum') return (draft as string[]).length > 0 ? draft : undefined
  const text = draft as string
  if (text === '') return undefined
  if (field.type === 'number' || field.type === 'integer') return Number(text)
  if (field.format === 'date-time') {
    const at = new Date(text)
    return Number.isNaN(at.getTime()) ? text : at.toISOString()
  }
  return text
}

const INPUT_TYPE: Record<string, string> = {
  email: 'email',
  uri: 'url',
  date: 'date',
  'date-time': 'datetime-local',
}

/** The choices of an `enum` or `multi-enum` field, each with the label the kit gives it. */
const choicesOf = (field: ElicitationField) =>
  (field.options ?? []).map((value, at) => ({ value, label: field.labels?.[at] ?? value }))

export function useElicitationForm(schema: McpElicitationSchema | undefined) {
  const fields = useMemo(() => elicitationFormFields(schema), [schema])
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, initialDraft(field)])),
  )
  const content = useMemo(() => {
    const out: Record<string, ElicitationValue> = {}
    for (const field of fields) {
      const value = fieldValue(field, drafts[field.name] ?? initialDraft(field))
      if (value !== undefined) out[field.name] = value
    }
    return out
  }, [drafts, fields])
  const problems = useMemo(() => elicitationFieldProblems(schema, content), [schema, content])
  return {
    fields,
    drafts,
    content,
    problems,
    ok: Object.keys(problems).length === 0,
    setDraft: (name: string, value: Draft) => setDrafts((all) => ({ ...all, [name]: value })),
  }
}

export function ElicitationFields({
  form,
  showErrors,
  disabled,
  onEnter,
}: {
  form: ReturnType<typeof useElicitationForm>
  showErrors: boolean
  disabled: boolean
  onEnter: () => void
}) {
  const errors = showErrors ? form.problems : {}
  // The frame's window listener defers to typing targets, so a field submits on its own Enter.
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onEnter()
  }
  return (
    <div className="flex flex-col gap-2.5">
      {form.fields.map((field) => {
        const { name } = field
        const label = field.title ?? name
        const draft = form.drafts[name]
        const common = {
          label,
          description: field.description,
          error: errors[name],
          required: field.required,
          disabled,
        }
        if (field.type === 'boolean')
          return (
            <Field key={name} {...common} layout="inline">
              <Checkbox
                checked={draft === true}
                onChange={(event) => form.setDraft(name, event.target.checked)}
              />
            </Field>
          )
        if (field.type === 'multi-enum') {
          const chosen = (draft as string[] | undefined) ?? []
          // A set of choices is a fieldset, not a Field: a Field labels ONE control.
          return (
            <fieldset key={name} disabled={disabled} className="flex min-w-0 flex-col gap-1">
              <legend className="mb-0.5 text-xs font-medium text-text-soft">
                {label}
                {common.required ? <span className="text-status-error/90"> *</span> : null}
              </legend>
              {field.description ? (
                <p className="text-xs/relaxed text-text-faint">{field.description}</p>
              ) : null}
              {choicesOf(field).map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-xs text-text-strong"
                >
                  <Checkbox
                    checked={chosen.includes(option.value)}
                    onChange={(event) =>
                      form.setDraft(
                        name,
                        event.target.checked
                          ? [...chosen, option.value]
                          : chosen.filter((value) => value !== option.value),
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
              {common.error ? (
                <p role="alert" className="text-xs/relaxed text-status-error">
                  {common.error}
                </p>
              ) : null}
            </fieldset>
          )
        }
        if (field.type === 'enum')
          return (
            <Field key={name} {...common}>
              <Select
                value={(draft as string) ?? ''}
                onValueChange={(value) => form.setDraft(name, value)}
                options={choicesOf(field)}
                placeholder="Choose…"
                size="lg"
              />
            </Field>
          )
        const numeric = field.type === 'number' || field.type === 'integer'
        return (
          <Field key={name} {...common}>
            <Input
              size="lg"
              type={numeric ? 'number' : (INPUT_TYPE[field.format ?? ''] ?? 'text')}
              step={field.type === 'integer' ? 1 : undefined}
              min={field.minimum}
              max={field.maximum}
              value={(draft as string) ?? ''}
              onChange={(event) => form.setDraft(name, event.target.value)}
              onKeyDown={submitOnEnter}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        )
      })}
    </div>
  )
}
