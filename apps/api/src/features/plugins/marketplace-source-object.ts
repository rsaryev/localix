import { errorMessage } from '../../lib/errors'
import { parseNpmEntrySource } from './marketplace-source-npm'
import type { MarketplaceSource } from './marketplace-source'

/**
 * A marketplace source written as an object, as `extraKnownMarketplaces` holds it
 * (marketplace-reference.md, "Marketplace sources"): `github` and `git` (with `ref`, `path` — the
 * catalog's place in the repository — and `sparsePaths`), `url` (with `headers` and
 * `headersHelper`), `file`, `directory`, an inline `settings` catalog, or `npm`. `skillsDir`,
 * `hostPattern` and `pathPattern` belong to the policy lists only, so they are refused here.
 */

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.flatMap((entry) => (text(entry) ? [text(entry)!] : []))
  return list.length ? list : undefined
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

/** The git fields both repository types share. */
function repoFields(obj: Record<string, unknown>) {
  const ref = text(obj.ref)
  const path = text(obj.path)
  const sparsePaths = stringList(obj.sparsePaths)
  return {
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
    ...(sparsePaths ? { sparsePaths } : {}),
  }
}

export function parseMarketplaceSourceObject(
  obj: Record<string, unknown>,
): MarketplaceSource | { error: string } {
  const kind = obj.source
  switch (kind) {
    case 'github': {
      const repo = text(obj.repo)
      if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo))
        return { error: 'A github marketplace source needs "repo" as owner/repo' }
      return { source: 'github', repo, ...repoFields(obj) }
    }
    case 'git': {
      const url = text(obj.url)
      if (!url) return { error: 'A git marketplace source needs "url"' }
      return { source: 'git', url, ...repoFields(obj) }
    }
    case 'url': {
      const url = text(obj.url)
      if (!url || !/^https?:\/\//i.test(url))
        return { error: 'A url marketplace source needs an http(s) "url"' }
      const headers = stringMap(obj.headers)
      const headersHelper = text(obj.headersHelper)
      return {
        source: 'url',
        url,
        ...(headers ? { headers } : {}),
        ...(headersHelper ? { headersHelper } : {}),
      }
    }
    case 'file':
    case 'directory': {
      const path = text(obj.path)
      if (!path) return { error: `A ${kind} marketplace source needs "path"` }
      return { source: kind === 'file' ? 'file' : 'local', path }
    }
    case 'settings': {
      const name = text(obj.name)
      if (!name || !Array.isArray(obj.plugins))
        return { error: 'A settings marketplace source needs "name" and a "plugins" array' }
      const owner = obj.owner && typeof obj.owner === 'object' ? obj.owner : undefined
      return {
        source: 'settings',
        name,
        plugins: obj.plugins as Record<string, unknown>[],
        ...(owner ? { owner: owner as Record<string, unknown> } : {}),
      }
    }
    default:
      if (kind === 'npm' || typeof obj.npm === 'string' || typeof obj.package === 'string') {
        try {
          const npm = parseNpmEntrySource('marketplace', obj)
          if (npm) return { source: 'npm', ...npm }
        } catch (err) {
          return { error: errorMessage(err) }
        }
      }
      return { error: `Unsupported marketplace source type "${String(kind)}"` }
  }
}
