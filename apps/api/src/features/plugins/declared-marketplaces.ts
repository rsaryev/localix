import { errorMessage } from '../../lib/errors'
import {
  asRecorded,
  declaredMarketplaces,
  readKnownMarketplaces,
  sameMarketplaceSource,
  writeKnownMarketplaces,
  type DeclaredMarketplace,
} from './kit'
import {
  addMarketplace,
  marketplacesRoot,
  removeMarketplace,
  type MarketplaceRegistryDeps,
} from './marketplace-registry'
import { withMarketplaceMutationLock } from './marketplace-lock'

/**
 * Marketplaces a Claude Code settings file declares under `extraKnownMarketplaces`, registered here
 * without anyone adding them, as Claude Code does after a session starts (loading.md, "Plugins and
 * marketplaces that aren't on disk at session start"). Which entry counts is the kit's plan
 * (`declaredMarketplaces` in `./kit`); its `autoUpdate` is recorded on the marketplace for the
 * background update pass. A source the user's or managed settings changed is fetched from the new
 * one; a project's settings cannot re-point a marketplace already added.
 */

/** Register each declared marketplace not yet known from that source; failures are warnings. */
export async function registerDeclaredMarketplaces(
  declared: readonly DeclaredMarketplace[],
  deps: MarketplaceRegistryDeps,
): Promise<{ added: string[]; warnings: string[] }> {
  const root = deps.root ?? marketplacesRoot()
  const added: string[] = []
  const warnings: string[] = []
  for (const entry of declared) {
    if (entry.refused) {
      warnings.push(`Marketplace "${entry.name}" from ${entry.from} settings: ${entry.refused}`)
      continue
    }
    const known = (await readKnownMarketplaces(root))[entry.name]
    if (known && sameMarketplaceSource(known.source, asRecorded(entry.source))) continue
    try {
      // A source changed in the user's or the organization's settings is fetched from there, as
      // in Claude Code; a repository's settings may not re-point a marketplace already added.
      if (known && (entry.from === 'user' || entry.from === 'managed'))
        await removeMarketplace(entry.name, deps)
      const result = await addMarketplace(entry.source, deps, entry.inline)
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
