import { InvalidRequestError } from '../../lib/domain-errors'
import type { ArchiveFetchPlan, MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import { archiveHeaders, helperAcceptance, type UrlSourceHeaders } from './kit'

/**
 * A marketplace entry's `headersHelper` (host-marketplace.md, "How users accept a headersHelper
 * command"): a command printing the headers its archive download needs. It runs only when the
 * person installs or updates that one plugin and accepts it: the install that has not is refused
 * with the command, the archive URL and the acceptance to pass (`--accept-command <sha256>`), and
 * an acceptance counts for that command, plugin and catalog alone (`helperAcceptance`, the kit's). What runs, where, and what its output may
 * set is the kit's (`archiveHeaders` in `./kit`).
 */

/**
 * The kit's archive plan with the headers it is downloaded with: the marketplace's `url` source's
 * on its origin, the entry's over them, its accepted command's output over those.
 */
export async function withArchiveHeaders(
  plan: ArchiveFetchPlan,
  entry: Pick<MarketplaceEntry, 'headers' | 'headersHelper'>,
  ref: { plugin: string; marketplace: string; source?: UrlSourceHeaders },
  opts: {
    accepted?: string | undefined
    managedSettingsDir?: string | undefined
    /** The marketplace catalog as written, read only when the entry has a command. */
    catalog: () => Promise<string>
  },
): Promise<ArchiveFetchPlan> {
  const headersHelper = entry.headersHelper?.trim() ? entry.headersHelper : undefined
  if (headersHelper !== undefined) {
    const decided = await helperAcceptance({
      command: headersHelper,
      plugin: `${ref.plugin}@${ref.marketplace}`,
      catalog: await opts.catalog(),
      accepted: opts.accepted,
    })
    if (!decided.run)
      throw new InvalidRequestError(
        'plugin_command_needs_acceptance',
        `"${ref.plugin}" fetches ${plan.url} with the headers its command prints: \`${headersHelper}\`. To run it, install or update "${ref.plugin}" by itself with --accept-command ${decided.sha256}`,
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
