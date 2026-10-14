import { useMemo } from 'react'
import { timeGreeting } from '@/shared/lib/greeting'
import { BirdStage } from '@/shared/ui/BirdStage'

interface EmptyStateProps {
  /**
   * Whether a provider connection exists. When false (e.g. onboarding skipped),
   * a pointer to the model menu is surfaced. Defaults to true so surfaces without
   * connection context (the editor-grid empty workspace) stay clean.
   */
  hasConnection?: boolean
}

export function EmptyState({ hasConnection = true }: EmptyStateProps) {
  const greeting = useMemo(() => timeGreeting(), [])

  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center px-4 py-8">
      <BirdStage spread={200} />

      <p className="mt-5 font-heading text-2xl font-semibold tracking-[-0.03em] text-text-strong">
        {greeting}
      </p>
      <p className="mt-1.5 text-sm text-text-faint">
        {hasConnection
          ? 'What would you like to accomplish?'
          : 'Connect a provider to start working.'}
      </p>

      {!hasConnection && (
        /* No connection — point to the model menu, where providers are connected. */
        <p className="mt-6 text-2xs text-text-faint">Pick a provider from the model menu below.</p>
      )}
    </div>
  )
}
