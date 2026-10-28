import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

import { InvalidRequestError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { isCredentialEnvName } from '../../lib/credential-env-name'
import { childEnvNonInteractive } from '../../lib/login-shell-env'
import { claudeConfigDir } from '../cc-settings/config-dir'
import { stringHeaders } from './marketplace-entry-source'
import { helperCommandProblem } from './marketplace-headers'

const execFileAsync = promisify(execFile)

/**
 * A marketplace entry's `headersHelper` (host-marketplace.md, "How users accept a headersHelper
 * command"): a command printing the headers its archive download needs. It runs only when the
 * person installs or updates that one plugin and accepts it: the install that has not is refused
 * with the command, the archive URL and the acceptance to pass (`--accept-command <sha256>`), and
 * an acceptance counts for that command and URL alone. It runs through `sh` in Claude Code's
 * configuration directory with the credential-looking variables removed and
 * `CLAUDE_CODE_PLUGIN_NAME` / `CLAUDE_CODE_PLUGIN_ARCHIVE_URL` set, must print one JSON object of
 * string values within 10 seconds, and routing headers in its output are dropped.
 */

const HELPER_TIMEOUT_MS = 10_000

/** What accepting `command` for `archiveUrl` is: the sha256 of the two. */
export function headersHelperAcceptance(command: string, archiveUrl: string): string {
  return createHash('sha256').update(`${command}\n${archiveUrl}`).digest('hex')
}

/** The headers the accepted helper prints, or a refusal that shows what would run. */
export async function entryHelperHeaders(input: {
  plugin: string
  command: string
  archiveUrl: string
  accepted?: string
  homeDir?: string
}): Promise<Record<string, string>> {
  const sha = headersHelperAcceptance(input.command, input.archiveUrl)
  if (input.accepted !== sha)
    throw new InvalidRequestError(
      'plugin_command_needs_acceptance',
      `"${input.plugin}" fetches ${input.archiveUrl} with the headers its command prints: \`${input.command}\`. To run it, install or update "${input.plugin}" by itself with --accept-command ${sha}`,
    )
  const problem = helperCommandProblem(input.command)
  if (problem) throw new Error(`headersHelper "${input.command}" is refused: ${problem}`)
  const env = Object.fromEntries(
    Object.entries(childEnvNonInteractive()).filter(([name]) => !isCredentialEnvName(name)),
  )
  // Claude Code's folder when there is one; a computer that never ran Claude Code has none, and a
  // missing working folder fails the spawn itself (as an ENOENT for `sh`).
  const home = input.homeDir ?? homedir()
  const configDir = claudeConfigDir(home)
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('sh', ['-c', input.command], {
      cwd: existsSync(configDir) ? configDir : home,
      timeout: HELPER_TIMEOUT_MS,
      env: {
        ...env,
        CLAUDE_CODE_PLUGIN_NAME: input.plugin,
        CLAUDE_CODE_PLUGIN_ARCHIVE_URL: input.archiveUrl,
      },
      windowsHide: true,
    }))
  } catch (error) {
    throw new Error(`headersHelper "${input.command}" failed: ${errorMessage(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    parsed = undefined
  }
  const headers = stringHeaders(parsed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`headersHelper "${input.command}" did not print a JSON object`)
  return headers ?? {}
}

/** An archive source with its accepted helper's headers merged in (the helper's win a name). */
export async function withEntryHelperHeaders<
  A extends { url: string; headers?: Record<string, string>; headersHelper?: string },
>(archive: A, plugin: string, accepted?: string): Promise<Omit<A, 'headersHelper'>> {
  const { headersHelper, ...rest } = archive
  if (!headersHelper) return rest
  const printed = await entryHelperHeaders({
    plugin,
    command: headersHelper,
    archiveUrl: archive.url,
    ...(accepted ? { accepted } : {}),
  })
  return { ...rest, headers: { ...rest.headers, ...printed } }
}
