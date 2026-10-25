import { useState } from 'react'
import type { ConfigField } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { Switch } from '@localixai/kit/switch'
import { Textarea } from '@localixai/kit/textarea'
import { ModelFieldSelect } from '@/shared/ui/ModelFieldSelect'
import type { DraftValue } from '../model/configDraft'

/**
 * The control a configuration field's type calls for. The form decides nothing from a field's
 * key or from the package kind: `type` says which control it is, and `secret` that its value is
 * never shown (`docs/internals/store.md`, "Configuration").
 */
export function ConfigControl({
  field,
  value,
  held,
  onChange,
}: {
  field: ConfigField
  value: DraftValue
  /** A secret that already has a value stored. */
  held: boolean
  onChange: (value: DraftValue) => void
}) {
  if (field.secret)
    return <SecretControl field={field} held={held} value={value} onChange={onChange} />
  switch (field.type) {
    case 'boolean':
      return (
        <Switch checked={value === true} onChange={(event) => onChange(event.target.checked)} />
      )
    case 'choice':
      return (
        <Select
          size="xl"
          className="w-full"
          value={String(value)}
          onValueChange={onChange}
          options={[
            ...(field.required ? [] : [{ value: '', label: '—' }]),
            ...(field.options ?? []).map((option) => ({
              value: option.value,
              label: option.label ?? option.value,
              description: option.description,
            })),
          ]}
        />
      )
    case 'list':
      return <ListControl value={Array.isArray(value) ? value : []} onChange={onChange} />
    case 'model':
      return <ModelFieldSelect value={String(value)} onValueChange={onChange} />
    case 'number':
      return (
        <Input
          size="xl"
          type="number"
          value={String(value)}
          min={field.min}
          max={field.max}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'string':
      return (
        <Input size="xl" value={String(value)} onChange={(event) => onChange(event.target.value)} />
      )
  }
}

/** One item per line. The typed text stays as typed, so a new line can be started. */
function ListControl({
  value,
  onChange,
}: {
  value: string[]
  onChange: (value: DraftValue) => void
}) {
  const [text, setText] = useState(() => value.join('\n'))
  return (
    <Textarea
      size="xl"
      className="font-mono text-xs"
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onChange(
          event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        )
      }}
    />
  )
}

/** A secret is never shown. Set, it says so and offers to replace it; the new value is masked. */
function SecretControl({
  field,
  held,
  value,
  onChange,
}: {
  field: ConfigField
  held: boolean
  value: DraftValue
  onChange: (value: DraftValue) => void
}) {
  const [replacing, setReplacing] = useState(!held)
  if (!replacing)
    return (
      <div className="flex h-(--chrome-control-xl) items-center justify-between gap-3 text-sm">
        <span className="text-text-soft">Set</span>
        <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
          Replace
        </Button>
      </div>
    )
  return (
    <Input
      size="xl"
      type="password"
      autoComplete="off"
      placeholder={held ? 'New value' : field.required ? 'Required' : ''}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
