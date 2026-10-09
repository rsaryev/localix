import { ProgressBar } from '@localixai/kit/progress-bar'
import type { UsageIndicatorView } from '../../model/contextUsageView'

const tokens = new Intl.NumberFormat('en-US')

export function ParticipantContextUsage({ view }: { view: UsageIndicatorView }) {
  const basis = view.ceilingTokens ?? view.policyWindowTokens ?? view.physicalWindowTokens
  const used = view.attempt?.contextTokens
  const rows: [string, number | undefined][] = [
    [view.attempt?.tokenKind === 'estimated' ? 'Context estimate' : 'Context used', used],
    ['Request limit', basis],
    ['Model window', view.physicalWindowTokens],
    ['Policy window', view.policyWindowTokens],
    ['Next checkpoint', view.checkpointAtTokens],
    ['Reserved headroom', view.reservedTokens],
  ]
  return (
    <section aria-label="Context usage" className="space-y-2 border-b border-border-soft pb-3">
      <div className="flex items-center justify-between gap-3 text-2xs">
        <span className="font-medium text-text-strong">Context usage</span>
        <span className="font-mono tabular-nums text-text-soft">{view.percentLabel}</span>
      </div>
      {view.fraction !== null ? (
        <ProgressBar
          value={view.fraction * 100}
          className="h-1.5 bg-surface-active"
          fillClassName="bg-foreground/60"
        />
      ) : (
        <p className="text-2xs text-text-faint">Current context measurement unavailable.</p>
      )}
      <dl className="space-y-1.5 text-2xs">
        {rows.map(([label, value]) =>
          value === undefined ? null : (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="text-text-faint">{label}</dt>
              <dd className="font-mono tabular-nums text-text-soft">{tokens.format(value)}</dd>
            </div>
          ),
        )}
      </dl>
      {view.attempt?.outcome === 'failed' ? (
        <p className="text-2xs text-text-faint">Latest attempt failed.</p>
      ) : null}
    </section>
  )
}
