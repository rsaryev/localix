import { AlertTriangle, X } from 'lucide-react'
import { useExternalAgentsProblem } from '../problems'
import { SearchInput } from '@localixai/kit/search-input'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { isProviderUnavailable } from '../model/useProviders'
import { bindingQuota, formatQuota, QUOTA_WARN_PERCENT, quotaIsCurrent } from '../model/types'
import type { ProviderStatus } from '../model/types'

/** One filter chosen on another surface, named so it can be cleared from this one. */
export interface Drill {
  key: string
  label: string
  value: string
  onClear: () => void
}

/**
 * The whole filter surface: text, providers, and sub-agent transcripts.
 *
 * It said "text, providers, states" and there has never been a state control here. Measured before
 * removing the claim rather than after: all 282 rows in a real history read `idle`, because a state
 * belongs to a LIVE delegation and historical rows have none — five pills of which four never match is
 * a control that teaches a reader to distrust the row. The tool keeps `states` for the orchestration
 * case, where a caller is asking about delegations it just launched.
 *
 * Every value here is sent to the backend as part of the roster query — none of it filters an
 * already-fetched array, because the fetched array is only ever one bounded page of a much larger
 * set.
 *
 * Providers and the sub-agent toggle are the SAME control (`TogglePill`) because they are the same
 * kind of choice. The provider pill carries the one thing a filter chip normally cannot: why a provider
 * contributes nothing. A failed scan or a machine with no `~/.codex` is indistinguishable from
 * "you have no Codex sessions" unless it is stated, so it is stated here rather than inferred
 * from an empty roster.
 */
/** Stable empty default: a literal here would be a new array on every render. */
const NO_DRILLS: readonly Drill[] = []

export function RosterFilters({
  text,
  onTextChange,
  providers,
  providersError,
  providersErrorDetail,
  activeProviders,
  onToggleProvider,
  includeChildren,
  onToggleChildren,
  drills = NO_DRILLS,
}: {
  text: string
  onTextChange: (text: string) => void
  providers: readonly ProviderStatus[]
  providersError: string | null
  /** The raw text behind `providersError`. Event Center only. */
  providersErrorDetail?: string | null
  activeProviders: readonly string[]
  onToggleProvider: (provider: string) => void
  /**
   * Sub-agent transcripts are hidden by default and are most of what exists: 1,540 of a real history's
   * 1,822 rows. `RosterQuery.includeChildren` and the route that validates it were reachable only from
   * the tool until this control existed.
   */
  includeChildren: boolean
  onToggleChildren: () => void
  /**
   * Filters chosen on the STATISTICS screen — a project, a model — which the roster obeys but had no
   * way of showing. A reader who drilled a bar and switched to the list saw a shorter list with every
   * control here reading "off": the filter is on and there is nothing to turn it off with. Same
   * `TogglePill` as the providers beside them, because leaving a filter is the same kind of act as
   * entering one.
   */
  drills?: readonly Drill[]
}) {
  const problem = useExternalAgentsProblem({
    subject: 'Providers',
    message: providersError,
    detail: providersErrorDetail,
  })
  return (
    // The canonical stacked search + scope/filter arrangement, so this row shares the pane's `px-3`
    // seam and bottom divider with the action row above it instead of carrying its own measure.
    <WorkbenchToolbar layout="stacked" aria-label="External agent filters">
      <SearchInput
        value={text}
        onValueChange={onTextChange}
        size="md"
        placeholder="Filter by title, id or directory"
        aria-label="Filter external agent sessions"
      />
      {problem ??
        (providers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {providers.map((provider) => (
              <ProviderPill
                key={provider.provider}
                provider={provider}
                active={activeProviders.includes(provider.provider)}
                onToggle={() => onToggleProvider(provider.provider)}
              />
            ))}
            <TogglePill
              active={includeChildren}
              onClick={onToggleChildren}
              title={
                includeChildren
                  ? 'Showing sub-agent transcripts beside the sessions that spawned them'
                  : 'Sub-agent transcripts are hidden — they are often most of the history'
              }
            >
              <span>sub-agents</span>
              <span className="tabular-nums text-text-faint">
                {providers.reduce((sum, provider) => sum + (provider.childSessionCount ?? 0), 0)}
              </span>
            </TogglePill>
          </div>
        ))}
      {drills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {drills.map((drill) => (
            <TogglePill
              key={drill.key}
              active
              onClick={drill.onClear}
              title={`${drill.label}: ${drill.value} — chosen on the statistics screen. Click to clear.`}
            >
              <span className="text-text-faint">{drill.label}</span>
              <span className="max-w-56 truncate">{drill.value}</span>
              <X className="size-3 shrink-0" aria-hidden />
            </TogglePill>
          ))}
        </div>
      )}
    </WorkbenchToolbar>
  )
}

function ProviderPill({
  provider,
  active,
  onToggle,
}: {
  provider: ProviderStatus
  active: boolean
  onToggle: () => void
}) {
  const unavailable = isProviderUnavailable(provider)
  const missingRoots = provider.roots.filter((root) => !root.exists).map((root) => root.path)
  const now = Date.now()
  const quotas = provider.quotas ?? []
  const notes = [
    provider.error != null ? `scan failed: ${provider.error}` : null,
    provider.error == null && unavailable ? `not found: ${missingRoots.join(', ')}` : null,
    provider.verified ? null : 'unverified adapter',
    // Only windows we have a live reading of — see the note in StatsView's QuotaBar.
    ...quotas.filter((reading) => quotaIsCurrent(reading, now)).map((r) => formatQuota(r, now)),
    provider.lastScanMs != null ? `scanned in ${provider.lastScanMs}ms` : null,
  ].filter((note): note is string => note != null)
  /**
   * Shown as a figure only near the limit; otherwise it lives in the title with the other notes.
   * 8% of a weekly window is trivia competing with the session count for the same few pixels, and a
   * chip that always shows a number teaches a reader to stop seeing it — which is precisely the
   * moment it starts to matter.
   */
  // The window a launch is actually up against, not whichever the provider listed first.
  const binding = bindingQuota(quotas, now)
  const pressing = binding && binding.usedPercent >= QUOTA_WARN_PERCENT ? binding : undefined

  return (
    <TogglePill
      active={active}
      onClick={onToggle}
      title={[provider.provider, ...notes].join(' — ')}
    >
      {unavailable && <AlertTriangle className="size-3 text-status-warning" aria-hidden />}
      <span>{provider.displayName}</span>
      <span
        className="tabular-nums text-text-faint"
        title={
          provider.childSessionCount
            ? `${provider.sessionCount} sessions · ${provider.childSessionCount} sub-agent transcripts beneath them`
            : `${provider.sessionCount} sessions`
        }
      >
        {provider.sessionCount}
      </span>
      {pressing && (
        <span className="tabular-nums text-status-warning" title={formatQuota(pressing, now)}>
          {Math.round(pressing.usedPercent)}%
        </span>
      )}
      {!provider.verified && <span className="text-text-faint">unverified</span>}
    </TogglePill>
  )
}
