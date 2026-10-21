import { ActivitySignal } from '@localixai/kit/activity-orb'

interface WorkingIndicatorProps {
  /** Verb to show, e.g. "Thinking", "Working", "Running bash". */
  label: string
  /** Extra classes for the wrapper. */
  className?: string
}

/**
 * Minimalist activity line shown during silent gaps. It reuses the persistent
 * Localix orb + cross-faded verb from the composer, while elapsed time stays in
 * the single composer status strip.
 */
export function WorkingIndicator({ label, className }: WorkingIndicatorProps) {
  return (
    <div
      className={`flex items-center text-xs text-text-faint ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      <ActivitySignal label={label} className="font-medium" />
    </div>
  )
}
