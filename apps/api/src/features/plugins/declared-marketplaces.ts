import { errorMessage } from '../../lib/errors'
import { isRecord } from '../../lib/record'
import { readSettingsFileLayers } from '../cc-settings/settings-files'
import { readManagedPolicy } from './claude-code-policy'
import { sameMarketplaceSource } from './marketplace-source-identity'
import { parseMarketplaceSourceObject } from './marketplace-source-object'
import {
  addMarketplace,
  marketplacesRoot,
  removeMarketplace,
  readKnownMarketplaces,
  type MarketplaceRegistryDeps,
  type MarketplaceSource,
} from './marketplace-registry'
import { withMarketplaceMutationLock } from './marketplace-lock'
import { writeKnownMarketplaces } from './marketplace-catalog'

/**
 * Marketplaces a Claude Code settings file declares under `extraKnownMarketplaces` (alias
 * `additionalMarketplaces`), registered here without anyone adding them, as Claude Code does after
 * a session starts (loading.md, "Plugins and marketplaces that aren't on disk at session start").
 * The files are the user's (`<config>/settings.json`), the project's `.claude/settings.json` and
 * `.claude/settings.local.json`, and managed settings, in rising precedence; the highest entry for
 * a name wins whole, so one file's headers never pair with another file's URL. A project file's
 * `headersHelper` is not run (a cloned repository could name any command); its fixed headers are.
 * A settings source must carry the entry's own name. Its `autoUpdate` is recorded on the
 * marketplace for the background update pass. A source the user's or managed settings changed is
 * fetched from the new one; a project's settings cannot re-point a marketplace already added.
 */

export type DeclaredFrom = 'user' | 'project' | 'local' | 'managed'

export interface DeclaredMarketplace {
  name: string
  source: MarketplaceSource
  from: DeclaredFrom
  autoUpdate?: boolean
}

const declarations = (settings: Record<string, unknown> | undefined) => {
  const value = settings?.extraKnownMarketplaces ?? settings?.additionalMarketplaces
  return isRecord(value) ? value : {}
}

export async function declaredMarketplaces(opts: {
  homeDir: string
  cwd: string | null
  env?: NodeJS.ProcessEnv
  managedSettingsDir?: string
}): Promise<DeclaredMarketplace[]> {
  // The settings files as the settings reader finds them (the local file at the repository root).
  const files = readSettingsFileLayers({
    homeDir: opts.homeDir,
    cwd: opts.cwd,
    env: opts.env,
    managed: null,
  })
  const layers: [DeclaredFrom, Record<string, unknown>][] = files.flatMap((layer) =>
    layer.source === 'user' || layer.source === 'project' || layer.source === 'local'
      ? [[layer.source, declarations(layer.settings)] as [DeclaredFrom, Record<string, unknown>]]
      : [],
  )
  layers.push([
    'managed',
    (await readManagedPolicy(opts.managedSettingsDir)).extraKnownMarketplaces ?? {},
  ])
  const byName = new Map<string, DeclaredMarketplace>()
  for (const [from, entries] of layers)
    for (const [name, entry] of Object.entries(entries)) {
      if (!isRecord(entry) || !isRecord(entry.source)) continue
      const parsed = parseMarketplaceSourceObject(entry.source)
      if ('error' in parsed) continue
      if (parsed.source === 'settings' && parsed.name !== name) continue
      let source: MarketplaceSource = parsed
      if ((from === 'project' || from === 'local') && source.source === 'url') {
        const { headersHelper: _dropped, ...fixed } = source
        source = fixed
      }
      byName.set(name, {
        name,
        source,
        from,
        ...(typeof entry.autoUpdate === 'boolean' ? { autoUpdate: entry.autoUpdate } : {}),
      })
    }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Register each declared marketplace not yet known from that source; failures are warnings. */
export async function registerDeclaredMarketplaces(
  declared: readonly DeclaredMarketplace[],
  deps: MarketplaceRegistryDeps,
): Promise<{ added: string[]; warnings: string[] }> {
  const root = deps.root ?? marketplacesRoot()
  const added: string[] = []
  const warnings: string[] = []
  for (const entry of declared) {
    const known = (await readKnownMarketplaces(root))[entry.name]
    if (known && sameMarketplaceSource(known.source, entry.source)) continue
    try {
      // A source changed in the user's or the organization's settings is fetched from there, as
      // in Claude Code; a repository's settings may not re-point a marketplace already added.
      if (known && (entry.from === 'user' || entry.from === 'managed'))
        await removeMarketplace(entry.name, deps)
      const result = await addMarketplace(entry.source, deps)
      added.push(result.name)
      if (entry.autoUpdate !== undefined) {
        await withMarketplaceMutationLock(root, async () => {
          const records = await readKnownMarketplaces(root)
          const record = records[result.name]
          if (record) {
            records[result.name] = { ...record, autoUpdate: entry.autoUpdate }
            await writeKnownMarketplaces(root, records)
          }
        })
      }
    } catch (error) {
      warnings.push(
        `Marketplace "${entry.name}" from ${entry.from} settings: ${errorMessage(error)}`,
      )
    }
  }
  return { added, warnings }
}

/**
 * Register the marketplaces a scope's settings declare, once per distinct declaration: Claude
 * Code checks them in the background after startup, so a listing never waits on a clone.
 */
export function createDeclaredMarketplaceSync(opts: {
  deps: MarketplaceRegistryDeps
  homeDir: string
  managedSettingsDir?: string
  warn?: (message: string) => void
}): (cwd: string | null) => Promise<void> {
  const done = new Set<string>()
  return async (cwd) => {
    const declared = await declaredMarketplaces({ ...opts, cwd }).catch(() => [])
    const key = JSON.stringify(declared)
    if (declared.length === 0 || done.has(key)) return
    done.add(key)
    const { warnings } = await registerDeclaredMarketplaces(declared, opts.deps)
    for (const warning of warnings) opts.warn?.(warning)
  }
}
