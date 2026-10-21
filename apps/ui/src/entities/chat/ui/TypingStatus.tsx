import { ActivitySignal, cleanActivityLabel } from '@localixai/kit/activity-orb'

/**
 * Single-line fallback for embedded transcript surfaces that do not own a composer
 * status line. It deliberately uses the same stable Localix activity primitive.
 */
export function TypingStatus({ label }: { label: string }) {
  const display = cleanActivityLabel(label)

  return (
    <div
      className="flex items-center text-xs text-text-soft"
      role="status"
      aria-live="polite"
      aria-label={display}
    >
      <ActivitySignal label={display} className="font-medium" />
    </div>
  )
}
