import { useMemo, useState, type KeyboardEvent } from 'react'
import type { McpElicitationField, McpElicitationSchema } from '@localixai/api/client'
import { elicitationOptions, validateElicitationContent } from '@localixai/api/mcp-elicitation'
import { Checkbox } from '@localixai/kit/checkbox'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'

/**
 * THE FORM OF AN MCP ELICITATION: one control per field of the server's flat schema, checked by
 * the same rule the server side applies (`validateElicitationContent`), so what Submit sends is
 * what the server accepts. The card around it owns the frame, the footer and the deadline.
 */

type Draft = string | boolean | string[]

function initialDraft(field: McpElicitationField): Draft {
  if (field.type === 'boolean') return typeof field.default === 'boolean' ? field.default : false
  if (field.type === 'array') return Array.isArray(field.default) ? field.default : []
  return field.default === undefined || Array.isArray(field.default) ? '' : String(field.default)
}

/** A typed draft as the protocol value it stands for; an empty optional answer is left out. */
function fieldValue(field: McpElicitationField, draft: Draft): unknown {
  if (field.type === 'boolean') return draft
  if (field.type === 'array') return (draft as string[]).length > 0 ? draft : undefined
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

export function useElicitationForm(schema: McpElicitationSchema | undefined) {
  const properties = useMemo(() => Object.entries(schema?.properties ?? {}), [schema])
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(properties.map(([name, field]) => [name, initialDraft(field)])),
  )
  const content = useMemo(() => {
    const out: Record<string, unknown> = {}
    for (const [name, field] of properties) {
      const value = fieldValue(field, drafts[name] ?? initialDraft(field))
      if (value !== undefined) out[name] = value
    }
    return out
  }, [drafts, properties])
  const check = useMemo(() => validateElicitationContent(schema, content), [schema, content])
  return {
    properties,
    drafts,
    check,
    setDraft: (name: string, value: Draft) => setDrafts((all) => ({ ...all, [name]: value })),
  }
}

export function ElicitationFields({
  form,
  required,
  showErrors,
  disabled,
  onEnter,
}: {
  form: ReturnType<typeof useElicitationForm>
  required: readonly string[]
  showErrors: boolean
  disabled: boolean
  onEnter: () => void
}) {
  const errors = showErrors && !form.check.ok ? form.check.errors : {}
  // The frame's window listener defers to typing targets, so a field submits on its own Enter.
  const submitOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onEnter()
  }
  return (
    <div className="flex flex-col gap-2.5">
      {form.properties.map(([name, field]) => {
        const label = field.title ?? name
        const draft = form.drafts[name]
        const options = elicitationOptions(field)
        const common = {
          label,
          description: field.description,
          error: errors[name],
          required: required.includes(name),
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
        if (field.type === 'array') {
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
              {(options ?? []).map((option) => (
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
        if (options)
          return (
            <Field key={name} {...common}>
              <Select
                value={(draft as string) ?? ''}
                onValueChange={(value) => form.setDraft(name, value)}
                options={options}
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
