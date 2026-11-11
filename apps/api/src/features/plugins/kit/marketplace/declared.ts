import { OFFICIAL_NAMES, type MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
import {
  createMarketplaceRegistry,
  createPolicyView,
  type FileScope,
  type Registration,
} from '@rsaryev/llx-plugin/settings'
import { isRecord } from '../../../../lib/record'
import { isFileScope } from '@rsaryev/llx-plugin/settings'
import { readClaudeSettings } from '../settings/read'
import { contentApplies } from '../settings/trust'
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

export interface DeclaredMarketplace {
  name: string
  source: MarketplaceSource
  from: FileScope
  /** The `autoUpdate` the winning entry sets. */
  autoUpdate?: boolean
  /** An inline (`settings`) source's catalog, as the settings write it. */
  inline?: unknown
  /** The managed policy does not let the source in: why. */
  refused?: string
}

/** The catalog an inline source writes: its name, owner and plugins as declared. */
function inlineCatalog(raw: unknown, name: string) {
  if (!isRecord(raw) || raw.source !== 'settings') return {}
  return {
    inline: { name, owner: isRecord(raw.owner) ? raw.owner : { name }, plugins: raw.plugins },
  }
}

function declared(reg: Registration): DeclaredMarketplace[] {
  const { from } = reg
  if (!isFileScope(from)) return []
  const refused = reg.status === 'refusedByAllowlist' ? reg.issues[0]?.message : undefined
  if (reg.status !== 'register' && refused === undefined) return []
  const source = parseDeclaredSource(reg.entry.source, reg.name)
  if ('error' in source) return []
  // The `autoUpdate` the winning entry writes (`autoUpdateFrom`); none when it leaves it unset.
  const autoUpdate = reg.autoUpdateFrom ? reg.entry.autoUpdate : undefined
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
    isFolderTrusted: () => contentApplies('extra-known-marketplaces', settings.trust.situation),
    officialMarketplaces: OFFICIAL_NAMES,
    check: (source) => gate.check(source),
  })
  return registry
    .registrations()
    .flatMap(declared)
    .sort((a, b) => a.name.localeCompare(b.name))
}
