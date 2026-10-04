import { memo } from 'react'
import type { ChatCacheDiagnosticsPayload, ChatUsagePayload } from '@localixai/agent'
import type { ReactNode } from 'react'
import { formatCompactTokens, formatCost } from '../../model/usageFormat'
import { cacheHitRate, uncachedInputTokens } from '../../model/usageMath'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { ContextRing } from '@localixai/kit/context-ring'
import { SectionLabel } from '@localixai/kit/section-label'
import { IconButton } from '@localixai/kit/icon-button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@localixai/kit/hover-card'
import { inspector } from '@/shared/lib/inspectorBus'
import type {
  ContextAttemptSnapshot,
  ContextTokenKind,
  ContextWindowDiagnostics,
} from '../../model/contextUsage'

interface UsageIndicatorProps {
  /** Usage from the last assistant turn that completed a provider request. */
  usage?: ChatUsagePayload
  /** The newest attempt, which may be newer than `usage` and may have failed pre-provider. */
  latestAttempt?: ContextAttemptSnapshot
  contextDiagnostics?: ContextWindowDiagnostics
  sessionUsage?: ChatUsagePayload
  cacheDiagnostics?: ChatCacheDiagnosticsPayload
  /** Physical model window from the selected catalog entry (diagnostic payload wins). */
  contextWindow?: number
}

const tokenFormatter = new Intl.NumberFormat('en-US')

// A subscription (OAuth plan) cost is a catalog-estimated API-equivalent value,
// NOT metered per-token spend — label it so the figure isn't read as real money.
const costRowLabel = (usage: ChatUsagePayload): string =>
  usage.costSource === 'subscription' ? 'Cost (plan, est.)' : 'Cost'

const attemptOutcomeLabel = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  unknown: 'Unknown',
} as const

const attemptStageLabel = {
  preflight: 'Pre-provider',
  provider: 'Provider',
  unknown: 'Unknown',
} as const

const tokenKindLabel = {
  measured: 'Provider measured',
  estimated: 'Runtime estimate',
  unknown: 'Unavailable',
} as const

export interface UsageIndicatorView {
  attempt: {
    outcome: ContextAttemptSnapshot['outcome']
    stage: ContextAttemptSnapshot['stage']
    contextTokens?: number
    tokenKind: ContextTokenKind
  } | null
  physicalWindowTokens?: number
  policyWindowTokens?: number
  /** The whole-request ceiling — the ring's denominator when known. */
  ceilingTokens?: number
  /** Where the next context checkpoint rewrites the model's view. */
  checkpointAtTokens?: number
  reservedTokens?: number
  fraction: number | null
  percentLabel: string
  fractionBasis: 'ceiling' | 'policy-window' | 'physical-window' | 'unknown'
  lastSuccessIsLatest: boolean
}

/**
 * Pure view-model builder: all provenance and denominator choices are pinned by
 * tests without coupling them to tooltip markup.
 */
export function buildUsageIndicatorView({
  usage,
  latestAttempt,
  contextDiagnostics,
  contextWindow,
}: Pick<
  UsageIndicatorProps,
  'usage' | 'latestAttempt' | 'contextDiagnostics' | 'contextWindow'
>): UsageIndicatorView {
  const physicalWindowTokens =
    contextDiagnostics?.fullWindowTokens && contextDiagnostics.fullWindowTokens > 0
      ? contextDiagnostics.fullWindowTokens
      : contextWindow && contextWindow > 0
        ? contextWindow
        : undefined
  const policyWindowTokens =
    contextDiagnostics?.policyWindowTokens && contextDiagnostics.policyWindowTokens > 0
      ? contextDiagnostics.policyWindowTokens
      : undefined
  const positive = (tokens: number | undefined) => (tokens && tokens > 0 ? tokens : undefined)
  const ceilingTokens = positive(contextDiagnostics?.ceilingTokens)
  const checkpointAtTokens = positive(contextDiagnostics?.checkpointAtTokens)
  const reservedTokens =
    contextDiagnostics?.reservedTokens && contextDiagnostics.reservedTokens > 0
      ? contextDiagnostics.reservedTokens
      : undefined

  let attempt: UsageIndicatorView['attempt'] = latestAttempt
    ? {
        outcome: latestAttempt.outcome,
        stage: latestAttempt.stage,
        contextTokens: latestAttempt.contextTokens,
        tokenKind: latestAttempt.tokenKind,
      }
    : usage
      ? {
          outcome: 'succeeded',
          stage: 'provider',
          contextTokens: usage.contextTokens,
          tokenKind: usage.contextTokens === undefined ? 'unknown' : 'measured',
        }
      : null

  // A failed or preflight attempt can have no provider usage while the
  // runtime still knows its resident-context estimate. Surface that estimate,
  // but keep its provenance explicit.
  const activeTokens = contextDiagnostics?.activeTokens
  if (
    attempt &&
    attempt.contextTokens === undefined &&
    activeTokens !== undefined &&
    Number.isFinite(activeTokens) &&
    activeTokens >= 0
  ) {
    attempt = {
      ...attempt,
      contextTokens: activeTokens,
      tokenKind: contextDiagnostics?.activeTokensKind ?? 'estimated',
    }
  }

  const basis = ceilingTokens ?? policyWindowTokens ?? physicalWindowTokens
  const fractionBasis = ceilingTokens
    ? 'ceiling'
    : policyWindowTokens
      ? 'policy-window'
      : physicalWindowTokens
        ? 'physical-window'
        : 'unknown'
  const rawFraction =
    attempt?.contextTokens === undefined || !basis
      ? null
      : Math.max(attempt.contextTokens / basis, 0)
  const fraction = rawFraction === null ? null : Math.min(rawFraction, 1)

  return {
    attempt,
    physicalWindowTokens,
    policyWindowTokens,
    ceilingTokens,
    checkpointAtTokens,
    reservedTokens,
    fraction,
    // Clamp only the ring/progress fill. The label must preserve overflow
    // evidence (for example 101%) instead of visually rewriting it to 100%.
    percentLabel: rawFraction === null ? '—' : `${Math.round(rawFraction * 100)}%`,
    fractionBasis,
    lastSuccessIsLatest: attempt?.outcome === 'succeeded',
  }
}

function UsageSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5 border-t border-border-soft pt-2 first:border-t-0 first:pt-0">
      <SectionLabel>{title}</SectionLabel>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function UsageRow({ label, tokens, value }: { label: string; tokens?: number; value?: string }) {
  const resolved = value ?? (tokens !== undefined ? tokenFormatter.format(tokens) : undefined)
  if (resolved === undefined) return null
  return (
    <div className="flex items-center justify-between gap-4 text-2xs">
      <span className="text-text-faint">{label}</span>
      <span className="font-mono tabular-nums text-text-soft">{resolved}</span>
    </div>
  )
}

/**
 * Memoized: every prop comes from the memoized transcript snapshot or the model
 * catalog, none from the draft — so `buildUsageIndicatorView` (the most
 * expensive per-render computation in the composer footer) stops running per
 * keystroke. It is passed as `accessory` to a NON-memoized ActionButtons, which
 * is fine: React.memo compares props, not element identity.
 */
export const UsageIndicator = memo(function UsageIndicator({
  usage,
  latestAttempt,
  contextDiagnostics,
  sessionUsage,
  cacheDiagnostics,
  contextWindow,
}: UsageIndicatorProps) {
  const view = buildUsageIndicatorView({
    usage,
    latestAttempt,
    contextDiagnostics,
    contextWindow,
  })
  if (!usage && !view.attempt && !contextDiagnostics) return null

  const cacheRate = cacheHitRate(usage?.cachedInputTokens, usage?.inputTokens)
  const cacheChanged = (cacheDiagnostics?.previous?.changed ?? []).length > 0
  const contextTokens = view.attempt?.contextTokens
  const accessibleLabel =
    contextTokens === undefined
      ? 'Context usage unavailable. Open Usage & Spend'
      : `Context usage ${formatCompactTokens(contextTokens)} tokens, ${view.percentLabel}. Open Usage & Spend`

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <IconButton
          size="lg"
          onClick={() => inspector.openStats()}
          className={[
            'rounded-lg',
            cacheChanged
              ? 'text-status-warning/80 hover:bg-status-warning/10 hover:text-status-warning/80'
              : 'text-text-faint hover:bg-surface-hover hover:text-text-soft',
          ].join(' ')}
          aria-label={accessibleLabel}
        >
          <ContextRing fraction={view.fraction ?? 0} dot={cacheRate !== null && cacheRate > 0} />
        </IconButton>
      </HoverCardTrigger>

      <HoverCardContent
        side="top"
        align="end"
        sideOffset={8}
        className="max-h-[min(32rem,var(--radix-hover-card-content-available-height))] w-64 max-w-[calc(100vw-1rem)] gap-3 select-text"
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-2xs">
            <span className="font-medium text-text-strong">Context usage</span>
            <span className="font-mono tabular-nums text-text-faint">{view.percentLabel}</span>
          </div>
          <ProgressBar
            value={(view.fraction ?? 0) * 100}
            className="h-1.5 w-full bg-surface-active"
            fillClassName={`transition-[width,background-color] duration-(--dur-slow) ${cacheChanged ? 'bg-status-warning/70' : 'bg-foreground/60'}`}
          />
        </div>

        {view.attempt && (
          <UsageSection title="Latest attempt">
            <UsageRow label="Status" value={attemptOutcomeLabel[view.attempt.outcome]} />
            <UsageRow label="Stage" value={attemptStageLabel[view.attempt.stage]} />
            <UsageRow
              label={
                view.attempt.tokenKind === 'measured'
                  ? 'Context used'
                  : view.attempt.tokenKind === 'estimated'
                    ? 'Context estimate'
                    : 'Context'
              }
              tokens={view.attempt.contextTokens}
              value={
                view.attempt.contextTokens === undefined
                  ? tokenKindLabel[view.attempt.tokenKind]
                  : undefined
              }
            />
            {view.attempt.contextTokens !== undefined && (
              <UsageRow label="Provenance" value={tokenKindLabel[view.attempt.tokenKind]} />
            )}
          </UsageSection>
        )}

        {usage && (
          <UsageSection
            title={
              view.lastSuccessIsLatest
                ? 'Latest successful provider request'
                : 'Last successful provider request'
            }
          >
            <UsageRow label="Context used" tokens={usage.contextTokens} />
          </UsageSection>
        )}

        <UsageSection title="Context limits">
          <UsageRow label="Physical model window" tokens={view.physicalWindowTokens} />
          <UsageRow label="Localix policy window" tokens={view.policyWindowTokens} />
          <UsageRow label="Request ceiling" tokens={view.ceilingTokens} />
          <UsageRow label="Next checkpoint at" tokens={view.checkpointAtTokens} />
          <UsageRow label="Reserved headroom" tokens={view.reservedTokens} />
        </UsageSection>

        {usage && (
          <UsageSection
            title={
              view.lastSuccessIsLatest
                ? 'This turn (all requests)'
                : 'Last successful turn (all requests)'
            }
          >
            <UsageRow label="Total" tokens={usage.totalTokens} />
            <UsageRow label="Input" tokens={usage.inputTokens} />
            <UsageRow label="↳ Cached (read)" tokens={usage.cachedInputTokens} />
            <UsageRow
              label="↳ Uncached"
              tokens={uncachedInputTokens(
                usage.inputTokens,
                usage.cachedInputTokens,
                usage.cacheWriteTokens,
              )}
            />
            <UsageRow label="↳ Cache write" tokens={usage.cacheWriteTokens} />
            <UsageRow label="  ↳ 1h retention" tokens={usage.cacheWrite1hTokens} />
            <UsageRow label="Output" tokens={usage.outputTokens} />
            {usage.totalCost !== undefined && (
              <UsageRow label={costRowLabel(usage)} value={formatCost(usage.totalCost)} />
            )}
          </UsageSection>
        )}

        {sessionUsage && (
          <UsageSection title="Session total">
            <UsageRow label="Total" tokens={sessionUsage.totalTokens} />
            <UsageRow label="Input" tokens={sessionUsage.inputTokens} />
            <UsageRow label="↳ Cached (read)" tokens={sessionUsage.cachedInputTokens} />
            <UsageRow
              label="↳ Uncached"
              tokens={uncachedInputTokens(
                sessionUsage.inputTokens,
                sessionUsage.cachedInputTokens,
                sessionUsage.cacheWriteTokens,
              )}
            />
            <UsageRow label="↳ Cache write" tokens={sessionUsage.cacheWriteTokens} />
            <UsageRow label="  ↳ 1h retention" tokens={sessionUsage.cacheWrite1hTokens} />
            <UsageRow label="Output" tokens={sessionUsage.outputTokens} />
            {sessionUsage.totalCost !== undefined && (
              <UsageRow
                label={costRowLabel(sessionUsage)}
                value={formatCost(sessionUsage.totalCost)}
              />
            )}
          </UsageSection>
        )}

        {cacheDiagnostics && (
          <UsageSection title="Cache diagnostics">
            <UsageRow label="Provider" value={cacheDiagnostics.snapshot.providerId ?? 'unknown'} />
            <UsageRow label="Model" value={cacheDiagnostics.snapshot.modelId} />
            <UsageRow label="Target" value={cacheDiagnostics.snapshot.promptContextCacheTarget} />
            <UsageRow
              label="Changed"
              value={
                (cacheDiagnostics.previous?.changed ?? []).length > 0
                  ? cacheDiagnostics.previous?.changed.join(', ')
                  : 'none'
              }
            />
          </UsageSection>
        )}
      </HoverCardContent>
    </HoverCard>
  )
})
