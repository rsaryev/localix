import { useState } from 'react'
import type { ProviderEntry } from '@localixai/agent/catalog'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { SectionLabel } from '@localixai/kit/section-label'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'

type Setting = NonNullable<ProviderEntry['settings']>[number]

/**
 * What a cloud connection names besides its key — the region, resource or project its requests
 * go to (`ProviderEntry.settings`). The form owns the values; a required one left empty holds the
 * connection back, since no request could be made without it.
 */
export function useConnectionSettings(provider: ProviderEntry) {
  const fields = provider.settings ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const missing = fields.some((field) => field.required && !values[field.name]?.trim())
  const filled = Object.fromEntries(
    Object.entries(values)
      .map(([name, value]) => [name, value.trim()] as const)
      .filter(([, value]) => value),
  )
  return {
    fields,
    values,
    setValue: (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value })),
    missing,
    /** What a new connection is created with; undefined when nothing was filled in. */
    settings: Object.keys(filled).length > 0 ? filled : undefined,
    reset: () => setValues({}),
  }
}

export function ConnectionSettingsFields({
  fields,
  values,
  onChange,
}: {
  fields: readonly Setting[]
  values: Readonly<Record<string, string>>
  onChange: (name: string, value: string) => void
}) {
  if (fields.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel as="span" weight="semibold">
        Connection settings
      </SectionLabel>
      {fields.map((field) => (
        <label key={field.name} className="flex flex-col gap-1">
          <span className="text-2xs text-text-soft">
            {field.label}
            {field.required ? '' : ' (optional)'}
          </span>
          <Input
            type="text"
            size="lg"
            placeholder={field.placeholder ?? field.name}
            value={values[field.name] ?? ''}
            onChange={(event) => onChange(field.name, event.target.value)}
            aria-label={field.label}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ))}
    </div>
  )
}

/**
 * A connection's settings, editable in place: saved together, on every key of the connection. A
 * required one cannot be emptied, and Save waits for a change.
 */
export function ConnectionSettingsEditor({
  fields,
  saved,
  onSave,
}: {
  fields: readonly Setting[]
  saved: Readonly<Record<string, string>>
  onSave: (settings: Record<string, string>) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...saved }))
  const [busy, setBusy] = useState(false)
  if (fields.length === 0) return null
  const trimmed = Object.fromEntries(
    fields.map((field) => [field.name, values[field.name]?.trim() ?? '']),
  )
  const changed = fields.some((field) => trimmed[field.name] !== (saved[field.name] ?? ''))
  const missing = fields.some((field) => field.required && !trimmed[field.name])
  const save = async () => {
    setBusy(true)
    try {
      await onSave(trimmed)
    } catch (error) {
      toast.error('Could not save the connection settings', {
        description: errorMessage(error, '') || undefined,
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <ConnectionSettingsFields
        fields={fields}
        values={values}
        onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      />
      <Button
        variant="mono"
        size="lg"
        disabled={!changed || missing || busy}
        onClick={() => void save()}
        className="self-start rounded-lg px-3 font-semibold"
      >
        Save settings
      </Button>
    </div>
  )
}
