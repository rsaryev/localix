import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'

import { errorMessage } from '../../lib/errors'
import { childEnvNonInteractive } from '../../lib/login-shell-env'

const execFileAsync = promisify(execFile)

/**
 * The headers a marketplace's `url` source sends (host-marketplace.md, "Authenticate archive
 * downloads"): its `headers`, and the JSON object its `headersHelper` command prints, which wins
 * a name both set. The helper runs through `sh` in the configuration directory, must print one
 * object of string values and exit 0 within 10 seconds, and one run serves 60 seconds. The headers
 * go to the catalog fetch and to archive downloads on the catalog URL's origin only.
 */

const HELPER_TIMEOUT_MS = 10_000
const HELPER_REUSE_MS = 60_000
const cache = new Map<string, { at: number; headers: Record<string, string> }>()

export function helperCommandProblem(command: string): string | undefined {
  if (command.length > 500) return 'it is longer than 500 characters'
  if (!/^[\x20-\x7e]+$/.test(command)) return 'it holds characters other than printable ASCII'
  if (/ {4,}/.test(command)) return 'it holds a run of four or more spaces'
  return undefined
}

export async function runHeadersHelper(
  command: string,
  opts: { now?: () => number; cwd?: string } = {},
): Promise<Record<string, string>> {
  const problem = helperCommandProblem(command)
  if (problem) throw new Error(`headersHelper "${command}" is refused: ${problem}`)
  const now = (opts.now ?? Date.now)()
  const hit = cache.get(command)
  if (hit && now - hit.at < HELPER_REUSE_MS) return hit.headers
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync('sh', ['-c', command], {
      cwd: opts.cwd ?? homedir(),
      timeout: HELPER_TIMEOUT_MS,
      env: childEnvNonInteractive(),
      windowsHide: true,
    }))
  } catch (error) {
    throw new Error(`headersHelper "${command}" failed: ${errorMessage(error)}`)
  }
  const parsed = (() => {
    try {
      return JSON.parse(stdout) as unknown
    } catch {
      return undefined
    }
  })()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`headersHelper "${command}" did not print a JSON object`)
  const headers = Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
  cache.set(command, { at: now, headers })
  return headers
}

/** A url source's headers: `headers`, then what its helper prints. */
export async function urlSourceHeaders(src: {
  headers?: Record<string, string>
  headersHelper?: string
}): Promise<Record<string, string> | undefined> {
  if (!src.headers && !src.headersHelper) return undefined
  return {
    ...src.headers,
    ...(src.headersHelper ? await runHeadersHelper(src.headersHelper) : {}),
  }
}

/** Headers for a download URL: given only on `origin` (same scheme, host and port). */
export function onOrigin(
  origin: string,
  headers: Record<string, string> | undefined,
): (url: URL) => Record<string, string> | undefined {
  return (url) => (headers && url.origin === origin ? headers : undefined)
}

/** An archive's headers once a url marketplace's own apply: on that origin, under the entry's. */
export async function withSourceHeaders<
  T extends { url: string; headers?: Record<string, string> },
>(
  archive: T,
  source: { url: string; headers?: Record<string, string>; headersHelper?: string },
): Promise<T> {
  if (new URL(archive.url).origin !== new URL(source.url).origin) return archive
  const fromSource = await urlSourceHeaders(source)
  if (!fromSource) return archive
  return { ...archive, headers: { ...fromSource, ...archive.headers } }
}
