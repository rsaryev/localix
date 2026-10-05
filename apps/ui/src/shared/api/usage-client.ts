/**
 * Cost tracking — spend overview, the paged usage log, and its filter keys.
 * One of the `backendClient` domain modules spread into the facade in `./client`, so
 * `backendClient.getUsageOverview(...)` keeps working unchanged.
 */

import { client, unwrap, cleanQuery } from './internal'
import type { UsageOverview, UsageLogsPage, UsageKeys } from './contracts'

/** Shared filter across the overview + log reads. A `type`, not an `interface`:
 *  only a type alias gets the implicit index signature `cleanQuery` needs. */
type UsageFilter = {
  from?: string
  to?: string
  model?: string
  provider?: string
  session?: string
  agent?: string
}

export const usageApi = {
  async getUsageOverview(
    opts: UsageFilter & {
      groupBy: 'model' | 'provider' | 'kind' | 'agent'
      bucket: 'hour' | 'day'
    },
  ): Promise<UsageOverview> {
    return unwrap(await client.rpc.usage.overview.$get({ query: cleanQuery(opts) }))
  },

  async getUsageLogs(
    opts: UsageFilter & { cursor?: string | null; limit?: number },
  ): Promise<UsageLogsPage> {
    return unwrap(await client.rpc.usage.logs.$get({ query: cleanQuery(opts) }))
  },

  /** The distinct models/providers/sessions present in the log — drives the filter menus. */
  async getUsageKeys(): Promise<UsageKeys> {
    return unwrap(await client.rpc.usage.keys.$get())
  },
}
