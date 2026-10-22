import { join } from 'node:path'

import { MARKETPLACE_FILE } from '@localixai/claude-plugin'

import { pathExists } from '../ext/fs-discovery'
import { MARKETPLACE_CATALOG_FILE } from './manifest-locate'
import type { MarketplaceSource } from './marketplace-source'

/**
 * Claude Code marketplaces (`.claude-plugin/marketplace.json`) are read like our own catalog
 * (`marketplace-catalog.ts`); this module holds what is Claude Code's alone: the catalog file and
 * the marketplace names Claude Code reserves (code.claude.com/docs/en/plugins/marketplace-reference).
 */
export const CLAUDE_CODE_MARKETPLACE = MARKETPLACE_FILE

/**
 * Why a folder cannot be installed as a plugin because it is only a marketplace catalog, or null.
 * Claude Code installs a marketplace's plugins by name, never the marketplace folder itself.
 */
export async function marketplaceOnlyHint(dir: string): Promise<string | null> {
  const [native, foreign] = await Promise.all([
    pathExists(join(dir, MARKETPLACE_CATALOG_FILE)),
    pathExists(join(dir, CLAUDE_CODE_MARKETPLACE)),
  ])
  if (!native && !foreign) return null
  return 'This is a plugin marketplace: add it with /plugin marketplace add <source>, then install its plugins with /plugin install <name>@<marketplace>'
}

/** Official, community and directory names: usable only by a marketplace from github.com/anthropics/. */
const ANTHROPIC_NAMES = [
  'claude-code-marketplace',
  'claude-code-plugins',
  'claude-plugins-official',
  'anthropic-marketplace',
  'anthropic-plugins',
  'agent-skills',
  'anthropic-agent-skills',
  'life-sciences',
  'knowledge-work-plugins',
  'claude-for-legal',
  'claude-for-financial-services',
  'financial-services-plugins',
  'first-party-plugins',
  'claude-tag-plugins',
  'claude-community',
  'claude-plugins-community',
  'healthcare',
  'anthropic-plugin-directory',
  'claude-plugin-directory',
]
/** Names Claude Code gives plugins that come from no marketplace, plus package-manager names. */
const ALWAYS_RESERVED = [
  'inline',
  'builtin',
  'skills-dir',
  'synced',
  'claude-plugin-test',
  'npm',
  'pip',
  'uv',
  'cargo',
  'github',
  'gh',
]
const OBJECT_MEMBERS = new Set([
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
  '__proto__',
])

/** Letters, digits, `.`, `_` and `-`, starting with a letter or digit, with no `..`. */
const MARKETPLACE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** A spelling that differs only by separators or a trailing dot reads as the same name. */
const canonical = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/[^a-z0-9_]+/g, '-')

/** True when the source is a GitHub or git repository under github.com/anthropics/. */
function fromAnthropics(source: MarketplaceSource): boolean {
  if (source.source === 'github') return /^anthropics\//i.test(source.repo)
  if (source.source === 'git')
    return /^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[/:]anthropics\//i.test(source.url)
  return false
}

/**
 * Why Claude Code refuses to register a marketplace under `name` from `source`, or null when the
 * name is usable. Mirrors the reserved-name rules: the naming pattern, official names outside
 * github.com/anthropics/ (and other spellings or imitations of them), names Claude Code uses
 * itself, JavaScript object members, and the `claudeai-` prefix.
 */
export function marketplaceNameProblem(name: string, source: MarketplaceSource): string | null {
  // Bidirectional and control characters, or any non-ASCII letter, can disguise a name.
  if (/[^\x20-\x7e]/.test(name))
    return `Marketplace name "${name}" impersonates an official Anthropic/Claude marketplace`
  if (!MARKETPLACE_NAME_RE.test(name) || name.includes('..'))
    return `Marketplace name "${name}" may use only letters, digits, ".", "_" and "-", starting with a letter or digit`
  if (OBJECT_MEMBERS.has(name))
    return `Claude Code reserves this name and cannot register a marketplace under it: "${name}"`
  const lower = name.toLowerCase()
  if (ALWAYS_RESERVED.includes(lower)) return `Marketplace name "${name}" is reserved`
  if (lower.startsWith('claudeai-'))
    return `Cannot add marketplace "${name}": names starting with "claudeai-" are reserved for marketplaces hosted on claude.ai`
  if (fromAnthropics(source)) return null
  if (ANTHROPIC_NAMES.includes(name))
    return `The name '${name}' is reserved for official Anthropic marketplaces`
  const spelled = canonical(name)
  const official = ANTHROPIC_NAMES.find((reserved) => canonical(reserved) === spelled)
  if (official) return `"${name}" is another spelling of "${official}", a reserved marketplace name`
  const words = spelled.split(/[-_]/)
  const brand = words.some((word) => word === 'claude' || word === 'anthropic')
  const imitates =
    (brand && words.includes('official')) ||
    ANTHROPIC_NAMES.some((reserved) => spelled.startsWith(`${reserved}-`))
  return imitates ? 'Marketplace name impersonates an official Anthropic/Claude marketplace' : null
}
