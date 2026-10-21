import type { ProviderId } from './identity'
import type { QuotaReading } from './quotas'

export interface ProviderStatus {
  readonly provider: ProviderId
  readonly displayName: string
  /** Roots we actually probed, with whether each exists on this machine. */
  readonly roots: readonly { readonly path: string; readonly exists: boolean }[]
  /**
   * TOP-LEVEL sessions — the same population the roster and the statistics count.
   *
   * It deliberately excludes sub-agent transcripts. Claude Code can hold many times more sub-agent
   * files than top-level sessions, so counting every file made the providers strip show a figure
   * many times the length of the list beside it: two different quantities wearing one name.
   */
  readonly sessionCount: number
  /** Sub-agent transcripts nested under those sessions, when the provider nests any. */
  readonly childSessionCount?: number
  /** Populated when a scan failed — surfaced in the UI rather than swallowed. */
  readonly error?: string
  readonly lastScanMs?: number
  /** Whether this provider was verified against real on-disk data by its author. */
  readonly verified: boolean
  /**
   * The newest reading of EACH window this provider left on disk, when it records any. Several
   * because an account can be inside more than one window at once.
   */
  readonly quotas?: readonly QuotaReading[]
}
