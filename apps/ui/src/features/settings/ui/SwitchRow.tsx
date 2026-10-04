import type { ReactNode } from 'react'
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
  return (
    <SettingsRow className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <p className="text-sm text-foreground">{props.title}</p>
        <p className="text-sm leading-6 text-text-faint">{props.description}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Switch checked={props.checked} onChange={props.onChange} aria-label={props.label} />
      </div>
    </SettingsRow>
  )
}
