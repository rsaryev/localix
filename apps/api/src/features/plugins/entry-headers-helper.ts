import { createHash } from 'node:crypto'

import { InvalidRequestError } from '../../lib/domain-errors'
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
 * An archive source with the headers it is downloaded with: the marketplace's `url` source's on
 * its origin, the entry's over them, its accepted command's output over those.
 */
export async function withArchiveHeaders<
  A extends { url: string; headers?: Record<string, string>; headersHelper?: string },
>(
  archive: A,
  ref: { plugin: string; marketplace: string; source?: UrlSourceHeaders },
  opts: { accepted?: string | undefined; managedSettingsDir?: string | undefined },
): Promise<Omit<A, 'headersHelper' | 'headers'> & { headers?: Record<string, string> }> {
  const { headersHelper, headers: given, ...rest } = archive
  if (headersHelper !== undefined) {
    const sha = headersHelperAcceptance(headersHelper, archive.url)
    if (opts.accepted !== sha)
      throw new InvalidRequestError(
        'plugin_command_needs_acceptance',
        `"${ref.plugin}" fetches ${archive.url} with the headers its command prints: \`${headersHelper}\`. To run it, install or update "${ref.plugin}" by itself with --accept-command ${sha}`,
      )
  }
  if (headersHelper === undefined && !given && !ref.source) return rest
  const headers = await archiveHeaders(
    {
      archiveUrl: archive.url,
      plugin: ref.plugin,
      marketplace: ref.marketplace,
      entry: {
        ...(given ? { headers: given } : {}),
        ...(headersHelper === undefined ? {} : { headersHelper }),
      },
      ...(ref.source ? { source: ref.source } : {}),
      accepted: headersHelper !== undefined,
    },
    { managedSettingsDir: opts.managedSettingsDir },
  )
  return Object.keys(headers).length ? { ...rest, headers: { ...headers } } : rest
}
