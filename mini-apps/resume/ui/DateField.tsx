import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { ChoiceMenu } from './ChoiceMenu'
import { useFieldError } from './validation'
const months = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1).padStart(2, '0'),
  label: new Intl.DateTimeFormat('en', { month: 'long' }).format(new Date(2024, i, 1)),
}))
export function DateField({
  field,
  label,
  value,
  onChange,
  disabled = false,
}: {
  field: string
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [year = '', month = ''] = value.split('-')
  return (
    <Field label={label} error={useFieldError(field)} disabled={disabled}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Input
          aria-label={`${label} year`}
          value={year}
          inputMode="numeric"
          placeholder="Year"
          maxLength={4}
          className="min-w-0 flex-1"
          onChange={(event) => {
            const next = event.target.value.replace(/\D/gu, '')
            onChange(next ? `${next}${month ? `-${month}` : ''}` : '')
          }}
        />
        <ChoiceMenu
          label={months.find((item) => item.id === month)?.label ?? 'Year only'}
          disabled={disabled || year.length !== 4}
          entries={[
            { id: 'none', label: 'Year only', selected: !month, onSelect: () => onChange(year) },
            ...months.map((item) => ({
              ...item,
              selected: item.id === month,
              onSelect: () => onChange(`${year}-${item.id}`),
            })),
          ]}
        />
      </div>
    </Field>
  )
}
