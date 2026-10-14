import { ActivitySignal } from '@localixai/kit/activity-orb'

/** Compact shared activity treatment for text actions inside settings buttons. */
export function SettingsActionActivity({ label }: { label: string }) {
  return (
    <ActivitySignal
      label={label}
      className="text-xs [&_.lx-activity-orb]:text-current"
      labelClassName="min-w-0"
    />
  )
}
