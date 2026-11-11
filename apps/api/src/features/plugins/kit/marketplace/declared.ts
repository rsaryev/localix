import { OFFICIAL_NAMES, type MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
import {
  createMarketplaceRegistry,
  createPolicyView,
  type Registration,
} from '@rsaryev/llx-plugin/settings'
import { isRecord } from '../../../../lib/record'
import { readClaudeSettings, type ClaudeSettings } from '../settings/read'
import { marketplacePolicy } from './policy'
import { parseDeclaredSource } from './sources'

/**
 * The marketplaces Claude Code's settings files declare under `extraKnownMarketplaces`, as the kit
 * plans them (`createMarketplaceRegistry`; settings-reference.md, `extraKnownMarketplaces`): the
 * user's file, the project's and local files of a folder Claude Code trusts, and managed settings,
 * the highest entry for a name winning whole. The kit drops what a source may not keep from a
 * project's file (its `headersHelper`), and a source the managed allowlist or blocklist does not let
 * in comes back refused, with the policy's message. Registering them is the caller's.
 */

export type DeclaredFrom = 'user' | 'project' | 'local' | 'managed'

export interface DeclaredMarketplace {
  name: string
  source: MarketplaceSource
  from: DeclaredFrom
  /** The `autoUpdate` the winning entry sets. */
  autoUpdate?: boolean
  /** An inline (`settings`) source's catalog, as the settings write it. */
  inline?: unknown
  /** The managed policy does not let the source in: why. */
  refused?: string
}

const FROM: Readonly<Record<string, DeclaredFrom>> = {
  user: 'user',
  project: 'project',
  local: 'local',
  managed: 'managed',
}

/** The `autoUpdate` the winning file writes; the kit's registration gives the resolved value only. */
function statedAutoUpdate(settings: ClaudeSettings, reg: Registration): boolean | undefined {
  for (const file of settings.files.toReversed()) {
    if (file.scope !== reg.from) continue
    const entry: unknown = file.settings.extraKnownMarketplaces?.[reg.name]
    if (isRecord(entry)) return typeof entry.autoUpdate === 'boolean' ? entry.autoUpdate : undefined
  }
  return undefined
}

/** The catalog an inline source writes: its name, owner and plugins as declared. */
function inlineCatalog(raw: unknown, name: string) {
  if (!isRecord(raw) || raw.source !== 'settings') return {}
  return {
    inline: { name, owner: isRecord(raw.owner) ? raw.owner : { name }, plugins: raw.plugins },
  }
}

function declared(settings: ClaudeSettings, reg: Registration): DeclaredMarketplace[] {
  const from = FROM[reg.from]
  if (!from) return []
  const refused = reg.status === 'refusedByAllowlist' ? reg.issues[0]?.message : undefined
  if (reg.status !== 'register' && refused === undefined) return []
  const source = parseDeclaredSource(reg.entry.source, reg.name)
  if ('error' in source) return []
  const autoUpdate = statedAutoUpdate(settings, reg)
  return [
    {
      name: reg.name,
      source,
      from,
      ...(autoUpdate === undefined ? {} : { autoUpdate }),
      ...inlineCatalog(reg.entry.source, reg.name),
      ...(refused === undefined ? {} : { refused }),
    },
  ]
}

export async function declaredMarketplaces(opts: {
  homeDir: string
  cwd: string | null
  env?: Record<string, string | undefined>
  managedSettingsDir?: string | undefined
}): Promise<DeclaredMarketplace[]> {
  const managed =
    opts.managedSettingsDir === undefined ? {} : { managed: { dir: opts.managedSettingsDir } }
  const settings = await readClaudeSettings({
    homeDir: opts.homeDir,
    cwd: opts.cwd,
    ...(opts.env ? { env: opts.env } : {}),
    ...managed,
  })
  const { gate } = await marketplacePolicy(opts.managedSettingsDir)
  const registry = createMarketplaceRegistry(createPolicyView(settings.layers), {
    isFolderTrusted: () => settings.trusted,
    officialMarketplaces: OFFICIAL_NAMES,
    check: (source) => gate.check(source),
  })
  return registry
    .registrations()
    .flatMap((reg) => declared(settings, reg))
    .sort((a, b) => a.name.localeCompare(b.name))
}
