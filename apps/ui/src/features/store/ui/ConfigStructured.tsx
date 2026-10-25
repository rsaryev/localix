import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ConfigField } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { Checkbox } from '@localixai/kit/checkbox'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import type { DraftValue } from '../model/configDraft'

type Pairs = Array<[string, string]>

/**
 * A map field: one row per name and value, rows added and removed. The rows are kept as typed
 * (a new row is blank until named); only named rows reach the draft. A `masked` map is a secret's
 * replacement: its values are password inputs.
 */
export function MapControl({
  field,
  value,
  masked = false,
  onChange,
}: {
  field: ConfigField
  value: Record<string, string>
  masked?: boolean
  onChange: (value: DraftValue) => void
}) {
  const [rows, setRows] = useState<Pairs>(() => Object.entries(value))
  const base = useId()
  const edit = (next: Pairs) => {
    setRows(next)
    onChange(Object.fromEntries(next.filter(([name]) => name.trim() !== '')))
  }
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([name, text], at) => (
        <div key={`${base}-${at}`} className="flex items-center gap-2">
          <Input
            id={`${base}-n${at}`}
            size="xl"
            className="flex-1 font-mono text-xs"
            aria-label={`${field.label} name ${at + 1}`}
            placeholder="Name"
            value={name}
            onChange={(event) =>
              edit(rows.map((row, i) => (i === at ? [event.target.value, row[1]] : row)))
            }
          />
          <Input
            id={`${base}-v${at}`}
            size="xl"
            className="flex-[2] font-mono text-xs"
            type={masked ? 'password' : 'text'}
            autoComplete="off"
            aria-label={`${field.label} value ${at + 1}`}
            placeholder="Value"
            value={text}
            onChange={(event) =>
              edit(rows.map((row, i) => (i === at ? [row[0], event.target.value] : row)))
            }
          />
          <IconButton
            size="sm"
            aria-label={`Remove ${field.label} ${at + 1}`}
            onClick={() => edit(rows.filter((_, i) => i !== at))}
          >
            <X />
          </IconButton>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Add ${field.label}`}
          onClick={() => setRows([...rows, ['', '']])}
        >
          <Plus data-icon="inline-start" aria-hidden />
          Add
        </Button>
      </div>
    </div>
  )
}

/** A multiple choice: every option a tick box, the chosen ones kept in the option's order. */
export function MultiChoiceControl({
  field,
  value,
  onChange,
}: {
  field: ConfigField
  value: string[]
  onChange: (value: DraftValue) => void
}) {
  const base = useId()
  const options = field.options ?? []
  return (
    <div role="group" aria-label={field.label} className="flex flex-col gap-2">
      {options.map((option, at) => (
        <label key={option.value} className="flex items-start gap-2 text-sm text-foreground">
          <Checkbox
            id={`${base}-${at}`}
            aria-label={option.label ?? option.value}
            checked={value.includes(option.value)}
            onChange={(event) =>
              onChange(
                options
                  .map((candidate) => candidate.value)
                  .filter((choice) =>
                    choice === option.value ? event.target.checked : value.includes(choice),
                  ),
              )
            }
          />
          <span className="flex min-w-0 flex-col">
            <span>{option.label ?? option.value}</span>
            {option.description && (
              <span className="text-xs text-text-soft">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  )
}
