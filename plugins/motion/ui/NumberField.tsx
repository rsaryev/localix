import { useEffect, useState } from 'react'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  const [error, setError] = useState('')
  useEffect(() => {
    setText(String(value))
    setError('')
  }, [value])
  return (
    <Field label={label} error={error || undefined}>
      <Input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          setText(event.target.value)
          setError('')
        }}
        onBlur={() => {
          const next = Number(text)
          if (!text.trim() || !Number.isFinite(next) || next < min || next > max)
            setError(`Use a number between ${min} and ${max}.`)
          else onChange(next)
        }}
      />
    </Field>
  )
}
