import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Registry credentials from the user's `~/.npmrc`, as npm reads them: a `//host/path/:_authToken=`
 * line authorizes requests under that host and path, and `${VAR}` in its value reads the
 * environment. Claude Code fetches npm sources through the npm client, which sends them; Localix
 * talks to the registry itself, so it sends the matching token on each request, to that registry
 * only (never to a redirect target or another host).
 */

interface NpmToken {
  /** `//host/path/`, the prefix a request URL must start with once its scheme is dropped. */
  prefix: string
  header: string
}

function tokensIn(text: string, env: NodeJS.ProcessEnv): NpmToken[] {
  const out: NpmToken[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('//')) continue
    const match = line.match(/^(\/\/[^\s=]*?):(_authToken|_auth)\s*=\s*(.+)$/)
    if (!match) continue
    const value = match[3]!
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\$\{([^}]+)\}/g, (_m, name: string) => env[name] ?? '')
    if (!value) continue
    const prefix = match[1]!.endsWith('/') ? match[1]! : `${match[1]}/`
    out.push({ prefix, header: match[2] === '_auth' ? `Basic ${value}` : `Bearer ${value}` })
  }
  // The longest prefix is the most specific: it wins.
  return out.sort((a, b) => b.prefix.length - a.prefix.length)
}

/** A function giving the `authorization` header the user's `.npmrc` holds for a URL. */
export async function npmAuthFor(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Promise<(url: URL) => Record<string, string> | undefined> {
  const npmrc = await fs.readFile(join(home, '.npmrc'), 'utf8').catch(() => '')
  const tokens = tokensIn(npmrc, env)
  return (url) => {
    const bare = `//${url.host}${url.pathname}`
    const found = tokens.find((token) => bare.startsWith(token.prefix))
    return found ? { authorization: found.header } : undefined
  }
}
