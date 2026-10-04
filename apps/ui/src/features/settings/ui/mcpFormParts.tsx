import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'

/** One editable row. `id` is render-stable identity — the key and value are both
 *  user-typed, so neither can key the row without remounting it mid-keystroke. */
interface EnvRow {
  id: string
  name: string
  value: string
}

let envRowSeq = 0
const newEnvRow = (name: string, value: string): EnvRow => ({
  id: `env-${envRowSeq++}`,
  name,
  value,
})

/** Editable key/value rows for env vars or HTTP headers. */
export function EnvEditor({
  label,
  entries,
  onChange,
  disabled = false,
  keyPlaceholder = 'KEY',
  valuePlaceholder = 'value',
}: {
  label: string
  entries: Record<string, string>
  onChange: (next: Record<string, string>) => void
  disabled?: boolean
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  // Local ordered rows so editing a key doesn't drop focus / reorder.
  const [rows, setRows] = useState<EnvRow[]>(() =>
    Object.entries(entries).map(([k, v]) => newEnvRow(k, v)),
  )

  const commit = (next: EnvRow[]) => {
    setRows(next)
    const obj: Record<string, string> = {}
    for (const r of next) if (r.name.trim()) obj[r.name.trim()] = r.value
    onChange(obj)
  }

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-1.5 flex w-full items-baseline justify-between gap-2 text-xs font-medium text-text-soft">
        <span>{label}</span>
        <span className="font-normal text-text-faint">Optional</span>
      </legend>
      <div className="space-y-1.5">
        {rows.map((row, index) => (
          <div key={row.id} className="flex gap-1.5">
            <Input
              size="xl"
              className="w-2/5 font-mono text-xs"
              aria-label={`${label} key ${index + 1}`}
              placeholder={keyPlaceholder}
              value={row.name}
              onChange={(e) =>
                commit(rows.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r)))
              }
            />
            <Input
              size="xl"
              className="flex-1 font-mono text-xs"
              aria-label={`${label} value ${index + 1}`}
              placeholder={valuePlaceholder}
              value={row.value}
              onChange={(e) =>
                commit(rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))
              }
            />
            <IconButton
              size="md"
              tone="danger"
              onClick={() => commit(rows.filter((r) => r.id !== row.id))}
              aria-label={`Remove ${label.toLowerCase()} row`}
            >
              <X className="size-3.5" aria-hidden="true" />
            </IconButton>
          </div>
        ))}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setRows([...rows, newEnvRow('', '')])}
          className="px-1.5 text-text-soft"
        >
          + Add {label.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  )
}
