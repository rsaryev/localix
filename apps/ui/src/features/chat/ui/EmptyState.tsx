import { lazy, Suspense, useMemo } from 'react'
import { timeGreeting, firstNameOf } from '@/shared/lib/greeting'
import { BirdStage } from '@/shared/ui/BirdStage'

// Environment discovery is a first-run capability, not part of the connected
// chat startup path. The component already stays blank while its API request is
// pending, so a null Suspense fallback preserves the same stable layout.
const EnvDetectedProviders = lazy(() =>
  import('./prompt-input/EnvDetectedProviders').then(({ EnvDetectedProviders }) => ({
    default: EnvDetectedProviders,
  })),
)

interface EmptyStateProps {
  /** Display name (`name` profile) — personalizes the greeting, matching the splash. */
  name?: string | null
  /**
   * Whether a provider connection exists. When false (e.g. onboarding skipped),
   * a one-click connect prompt is surfaced. Defaults to true so surfaces without
   * connection context (the editor-grid empty workspace) stay clean.
   */
  hasConnection?: boolean
  /**
   * The chat this empty state belongs to: the one-click connect routes it to the new connection.
   * `null` for a surface with no chat (the editor-grid empty workspace) — never the chat on screen.
   */
  sessionId: string | null
}

export function EmptyState({ name, hasConnection = true, sessionId }: EmptyStateProps) {
  const greeting = useMemo(() => timeGreeting(), [])
  const firstName = firstNameOf(name)

  return (
    <div className="flex flex-1 select-none flex-col items-center justify-center px-4 py-8">
      <BirdStage spread={200} />

      <p className="mt-5 font-heading text-2xl font-semibold tracking-[-0.03em] text-text-strong">
        {greeting}
        {firstName && `, ${firstName}`}
      </p>
      <p className="mt-1.5 text-sm text-text-faint">
        {hasConnection
          ? 'What would you like to accomplish?'
          : 'Connect a provider to start working.'}
      </p>

      {!hasConnection && (
        /* No connection — surface one-click env-key connect (when any) + a hint to the model menu. */
        <div className="mt-6 flex w-full max-w-xs flex-col items-center gap-2">
          <Suspense fallback={null}>
            <EnvDetectedProviders sessionId={sessionId} title={null} />
          </Suspense>
          <p className="text-2xs text-text-faint">Or pick a provider from the model menu below.</p>
        </div>
      )}
    </div>
  )
}
