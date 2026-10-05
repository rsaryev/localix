import { useId, type ReactNode } from 'react'
import { Switch } from '@localixai/kit/switch'
import { SettingsRow } from './SettingsScaffold'

/** Shared title, explanation, and switch layout for boolean settings. */
export function SwitchRow(props: {
  title: string
  description: ReactNode
  checked: boolean
  onChange: () => void
  label: string
}) {
  const descriptionId = useId()
  return (
    <SettingsRow className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">{props.title}</p>
        <p id={descriptionId} className="max-w-prose text-xs leading-5 text-text-soft text-pretty">
          {props.description}
        </p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Switch
          checked={props.checked}
          onChange={props.onChange}
          aria-label={props.label}
          aria-describedby={descriptionId}
        />
      </div>
    </SettingsRow>
  )
}
