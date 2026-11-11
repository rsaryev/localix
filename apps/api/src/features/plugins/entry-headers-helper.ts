import { createHash } from 'node:crypto'

import { InvalidRequestError } from '../../lib/domain-errors'
import type { ArchiveFetchPlan, MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import { archiveHeaders, type UrlSourceHeaders } from './kit'

/**
 * A marketplace entry's `headersHelper` (host-marketplace.md, "How users accept a headersHelper
 * command"): a command printing the headers its archive download needs. It runs only when the
 * person installs or updates that one plugin and accepts it: the install that has not is refused
 * with the command, the archive URL and the acceptance to pass (`--accept-command <sha256>`), and
 * an acceptance counts for that command and URL alone. What runs, where, and what its output may
 * set is the kit's (`archiveHeaders` in `./kit`).
 */

/** What accepting `command` for `archiveUrl` is: the sha256 of the two. */
export function headersHelperAcceptance(command: string, archiveUrl: string): string {
  return createHash('sha256').update(`${command}\n${archiveUrl}`).digest('hex')
}

/**
 * The kit's archive plan with the headers it is downloaded with: the marketplace's `url` source's
 * on its origin, the entry's over them, its accepted command's output over those.
 */
export async function withArchiveHeaders(
  plan: ArchiveFetchPlan,
  entry: Pick<MarketplaceEntry, 'headers' | 'headersHelper'>,
  ref: { plugin: string; marketplace: string; source?: UrlSourceHeaders },
  opts: { accepted?: string | undefined; managedSettingsDir?: string | undefined },
): Promise<ArchiveFetchPlan> {
  const headersHelper = entry.headersHelper?.trim() ? entry.headersHelper : undefined
  if (headersHelper !== undefined) {
    const sha = headersHelperAcceptance(headersHelper, plan.url)
    if (opts.accepted !== sha)
      throw new InvalidRequestError(
        'plugin_command_needs_acceptance',
        `"${ref.plugin}" fetches ${plan.url} with the headers its command prints: \`${headersHelper}\`. To run it, install or update "${ref.plugin}" by itself with --accept-command ${sha}`,
      )
  }
  if (headersHelper === undefined && !entry.headers && !ref.source) return plan
  const headers = await archiveHeaders(
    {
      archiveUrl: plan.url,
      plugin: ref.plugin,
      marketplace: ref.marketplace,
      entry: {
        ...(entry.headers ? { headers: entry.headers } : {}),
        ...(headersHelper === undefined ? {} : { headersHelper }),
      },
      ...(ref.source ? { source: ref.source } : {}),
      accepted: headersHelper !== undefined,
    },
    { managedSettingsDir: opts.managedSettingsDir },
  )
  return { ...plan, headers }
}
