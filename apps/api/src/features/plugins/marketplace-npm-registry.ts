import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isForbiddenHost, type HopCheck } from './marketplace-download'

/**
 * Which npm URLs a plugin source may reach. As in Claude Code, a registry or tarball URL must be
 * `https://`, unless it points at the installing user's own default registry (an `http://`
 * Verdaccio on the LAN, say): with any other plain-http URL the install fails before the
 * registry is contacted.
 */

export const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org'

/** The `registry=` line of an `.npmrc` (scoped `@scope:registry=` lines are not the default). */
function registryLine(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#') || line.startsWith(';')) continue
    const match = line.match(/^registry\s*=\s*(.+)$/)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

/**
 * The user's default npm registry, as npm resolves it: `npm_config_registry` in the environment,
 * else `registry=` in `~/.npmrc`, else the public registry.
 */
export async function userDefaultNpmRegistry(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<string> {
  const fromEnv = env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY
  if (fromEnv?.trim()) return fromEnv.trim()
  const npmrc = await fs.readFile(join(home, '.npmrc'), 'utf8').catch(() => '')
  return registryLine(npmrc) ?? DEFAULT_NPM_REGISTRY
}

function originOf(url: string): string | null {
  return URL.canParse(url) ? new URL(url).origin : null
}

/**
 * Why an npm URL may not be requested, or null: https on a public host, or anything http(s) on
 * the user's default registry (which may well be a Verdaccio on localhost).
 */
export function npmUrlProblem(url: URL, defaultRegistry: string): string | null {
  const onDefault = url.origin === originOf(defaultRegistry)
  if (url.protocol === 'https:') {
    return onDefault || !isForbiddenHost(url.hostname)
      ? null
      : `${url.href} is not on a public host and is not your default npm registry`
  }
  if (url.protocol === 'http:') {
    return onDefault
      ? null
      : `${url.href} uses plain http and is not your default npm registry; use https://`
  }
  return `${url.href} is not an http(s) URL`
}

/** The redirect-hop rule for npm downloads: every hop held to `npmUrlProblem`. */
export function npmHop(defaultRegistry: string): HopCheck {
  return (url) => npmUrlProblem(url, defaultRegistry)
}
