import { useState } from 'react'

import { isModelConfigField } from '@/shared/api/contracts'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { ModelFieldSelect } from '@/shared/ui/ModelFieldSelect'
import { Select } from '@localixai/kit/select'
import { Switch } from '@localixai/kit/switch'
import { Textarea } from '@localixai/kit/textarea'
import { SettingsActionActivity } from './SettingsActionActivity'

/** Structural shape of a declared config field
 *  (the latter adds the optional `enum`). The form only reads these members. */
export interface ConfigFormField {
  key: string
  type: string
  description: string
  required: boolean
  secret: boolean
  value: string | number | boolean | null
  isSet: boolean
  /** Human-readable label. Rendered in place of `key` when present; falls back to `key`. */
  title?: string
  /** A list of strings (a plugin's `multiple` option): one item per line, saved as a JSON array. */
  multiple?: boolean
  /** Declared string choices — rendered as a picker when present (providers only). */
  enum?: { value: string; label?: string; description?: string }[]
}

/** A stored list (a JSON array of strings) as one item per line. */
function linesOf(value: string): string {
  try {
    const items: unknown = JSON.parse(value)
    return Array.isArray(items) ? items.map(String).join('\n') : value
  } catch {
    return value
  }
}

/** Typed lines as the stored list: each line trimmed, blank lines dropped. */
const listOf = (text: string): string =>
  JSON.stringify(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  )

/** One item per line. The typed text stays as typed, so a new line can be started; the list saves. */
function ListFieldEditor({
  value,
  onValueChange,
}: {
  value: string
  onValueChange: (value: string) => void
}) {
  const [text, setText] = useState(() => linesOf(value))
  return (
    <Textarea
      size="xl"
      className="font-mono text-xs"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onValueChange(listOf(event.target.value))
      }}
    />
  )
}

function ConfigFieldEditor({
  field,
  value,
  disabled,
  onValueChange,
}: {
  field: ConfigFormField
  value: string
  disabled: boolean
  onValueChange: (value: string) => void
}) {
  // The manifest title has one owner; `||` ensures a blank title never hides the stable key.
  const label = field.title || field.key

  return (
    <Field
      required={field.required}
      disabled={disabled}
      label={
        <>
          {label}
          {field.secret && (
            <span className="ml-1 text-text-faint">(secret{field.isSet ? ' · set' : ''})</span>
          )}
        </>
      }
      description={field.description || undefined}
    >
      {field.enum && field.enum.length > 0 ? (
        <Select
          size="xl"
          className="w-full"
          value={value}
          onValueChange={onValueChange}
          options={[
            ...(!field.required && !field.enum.some((option) => option.value === '')
              ? [{ value: '', label: '—' }]
              : []),
            // The server sends what each choice means; it used to be dropped on the way here.
            ...field.enum.map((option) => ({
              value: option.value,
              label: option.label ?? option.value,
              description: option.description,
            })),
          ]}
        />
      ) : field.type === 'boolean' ? (
        // An on/off value is a switch: a two-option list of the words "true" and "false" made
        // the person read a programming literal to say yes. Still saved with the form.
        <Switch
          checked={value === 'true' || value === '1'}
          onChange={(event) => onValueChange(event.target.checked ? 'true' : 'false')}
        />
      ) : field.multiple && !field.secret ? (
        <ListFieldEditor value={value} onValueChange={onValueChange} />
      ) : !field.secret && isModelConfigField(field) ? (
        <ModelFieldSelect value={value} onValueChange={onValueChange} />
      ) : (
        <Input
          size="xl"
          className="font-mono text-xs"
          type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
          placeholder={field.secret && field.isSet ? '•••••••• (leave blank to keep)' : ''}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
    </Field>
  )
}

/**
 * Config-field editor for the plugins settings
 * panels. Renders each field as the right control (enum select → boolean
 * switch → model picker → text/number/secret input) and submits a typed value
 * map; secrets left blank are omitted so the stored value is kept. The `enum`
 * branch is inert for plugin fields (they declare none), so this is behavior-
 * identical to the two forms it replaces.
 */
export function SettingsConfigForm({
  fields,
  busy,
  onSave,
}: {
  fields: ConfigFormField[]
  busy: boolean
  onSave: (values: Record<string, string | number | boolean>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    // Secrets never round-trip: start blank, keep existing unless retyped.
    for (const f of fields)
      init[f.key] = f.secret ? '' : f.value !== null && f.value !== undefined ? String(f.value) : ''
    return init
  })

  const submit = () => {
    const out: Record<string, string | number | boolean> = {}
    for (const f of fields) {
      const raw = values[f.key] ?? ''
      if (f.secret && raw === '') continue // keep existing secret
      if (f.type === 'number') {
        const n = Number(raw)
        if (!Number.isNaN(n)) out[f.key] = n
      } else if (f.type === 'boolean') out[f.key] = raw === 'true' || raw === '1'
      else out[f.key] = raw
    }
    onSave(out)
  }

  return (
    <div className="mt-3 ml-5 space-y-2.5 border-t border-border-faint pt-3">
      {fields.map((f) => {
        return (
          <ConfigFieldEditor
            key={f.key}
            field={f}
            value={values[f.key] ?? ''}
            disabled={busy}
            onValueChange={(value) => setValues((current) => ({ ...current, [f.key]: value }))}
          />
        )
      })}
      <div className="flex justify-end">
        <Button
          variant="mono"
          size="xl"
          onClick={submit}
          disabled={busy}
          aria-busy={busy || undefined}
          className="min-w-26 disabled:cursor-default disabled:opacity-100"
        >
          {busy ? <SettingsActionActivity label="Saving config" /> : 'Save config'}
        </Button>
      </div>
    </div>
  )
}
