import { homedir } from 'node:os'
import { join } from 'node:path'

import type { MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'

/**
 * Localix's own helpers around a marketplace's source: where its registry lives, the
 * `plugin@marketplace` reference, and finding a marketplace by the source it was added from. How
 * a source is typed, parsed and fetched is the kit's (`kit/marketplace/sources.ts`).
 */

/**
 * Does a recorded source match a typed marketplace reference (`owner/repo`, a git URL, a catalog
 * URL)? Lets `install name@owner/repo` find a marketplace registered under its catalog name.
 */
export function sourceMatchesRef(src: MarketplaceSource, ref: string): boolean {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .replace(/\/$/, '')
      .toLowerCase()
  const want = norm(ref)
  if (src.kind === 'github') return norm(src.repo) === want
  if (src.kind === 'git') return norm(src.url) === want
  if (src.kind === 'url') return src.url.trim() === ref.trim()
  if (src.kind === 'settings') return src.name === ref.trim()
  return false
}

export function marketplacesRoot(base?: string): string {
  return join(base ?? homedir(), '.localix', 'marketplaces')
}

/** Parse a `plugin@marketplace` reference. Returns null when there's no `@marketplace` part. */
export function parseMarketplaceRef(ref: string): { plugin: string; marketplace: string } | null {
  const m = ref.trim().match(/^([^@\s]+)@([^@\s]+)$/)
  return m ? { plugin: m[1], marketplace: m[2] } : null
}

/** Tiny stable hash for temp-dir names (avoids Date.now()/Math.random() in resumable paths). */
export function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}
