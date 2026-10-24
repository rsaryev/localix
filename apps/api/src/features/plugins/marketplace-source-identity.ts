import { resolve } from 'node:path'

import type { MarketplaceSource } from './marketplace-source'

/**
 * Whether two marketplace sources are the same one. Claude Code identifies a marketplace by its
 * catalog `name`, and a name registered from one source is never silently re-pointed at another:
 * the plugins installed from it would update from wherever the new source says. Two sources match
 * when they are the same kind with the same value in every field (a `ref` one sets and the other
 * does not counts as different), compared after trivial spelling differences are removed.
 */

const trimSlash = (value: string) => value.trim().replace(/\/+$/, '')
const optional = (value: string | undefined) => value?.trim() || undefined

function key(src: MarketplaceSource): string {
  switch (src.source) {
    case 'github':
      return JSON.stringify([
        'github',
        trimSlash(src.repo)
          .replace(/\.git$/i, '')
          .toLowerCase(),
        optional(src.ref),
        optional(src.path),
      ])
    case 'git':
      return JSON.stringify(['git', trimSlash(src.url), optional(src.ref), optional(src.path)])
    case 'local':
    case 'file':
      return JSON.stringify([src.source, resolve(src.path)])
    case 'url':
      return JSON.stringify(['url', src.url.trim()])
    case 'settings':
      return JSON.stringify(['settings', src.name, src.plugins])
    case 'npm':
      return JSON.stringify([
        'npm',
        src.package,
        optional(src.version),
        src.registry ? trimSlash(src.registry) : undefined,
      ])
  }
}

export function sameMarketplaceSource(a: MarketplaceSource, b: MarketplaceSource): boolean {
  return key(a) === key(b)
}

/** A source as one line, Claude Code's `<kind>:<value>` (`github:acme/plugins`). */
export function describeMarketplaceSource(src: MarketplaceSource): string {
  switch (src.source) {
    case 'github':
      return `github:${src.repo}${src.ref ? `#${src.ref}` : ''}`
    case 'git':
      return `git:${src.url}${src.ref ? `#${src.ref}` : ''}`
    case 'local':
    case 'file':
      return `${src.source === 'local' ? 'directory' : 'file'}:${src.path}`
    case 'url':
      return `url:${src.url}`
    case 'settings':
      return `settings:${src.name}`
    case 'npm':
      return `npm:${src.package}${src.version ? `@${src.version}` : ''}`
  }
}

/** Claude Code's refusal when a catalog name is already registered from another source. */
export function differentSourceMessage(name: string, existing: MarketplaceSource): string {
  return `Marketplace "${name}" is already added from a different source (${describeMarketplaceSource(existing)}). To use this source instead, remove that marketplace first with /plugin marketplace remove ${name}.`
}
