import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import { useFieldError } from './validation'
import { Textarea } from '@localixai/kit/textarea'

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  maxLength = 500,
  placeholder,
  field,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  maxLength?: number
  field?: string
  placeholder?: string
  disabled?: boolean
}) {
  const error = useFieldError(field)
  return (
    <Field label={label} error={error} disabled={disabled}>
      {multiline ? (
        <Textarea
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          rows={5}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
