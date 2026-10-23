/**
 * Regenerate the bundled Localix marketplace catalog at
 * `plugins/.localix-plugin/marketplace.json` from the actual bundled plugins.
 *
 * The catalog lists every plugin under the repo's `plugins/` root with a
 * relative `./<name>` source. Run after adding/removing/renaming a bundled plugin:
 *
 *   bun run apps/api/scripts/generate-bundled-marketplace.ts
 *
 * The committed file is guarded by marketplace.test.ts (must parse + validate clean).
 */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { discoverBundledMiniApps, bundledMiniAppsRoot } from '../src/features/plugins/discovery'
import { validateMarketplace } from '../src/features/plugins/marketplace'
import { buildMarketplaceManifest } from '../src/features/plugins/marketplace-build'
import {
  MARKETPLACE_CATALOG_FILE,
  MARKETPLACE_METADATA_FILE,
} from '../src/features/plugins/manifest-locate'

async function main(): Promise<void> {
  // Hermetic bundled-only scan: `discoverPlugins` merges the developer's installed
  // plugins ahead of bundled and dedupes by name, so a same-named local install would SHADOW the
  // bundled copy and silently drop it from
  // the catalog — making generation depend on what the dev happens to have installed.
  const bundled = (await discoverBundledMiniApps()).filter((p) => !p.error)
  const metadataFile = join(bundledMiniAppsRoot(), MARKETPLACE_METADATA_FILE)
  const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8')) as {
    name: string
    description?: string
    owner?: { name: string; email?: string }
    renames?: Record<string, string | null>
  }

  const market = buildMarketplaceManifest({
    ...metadata,
    plugins: bundled.map((p) => ({
      name: p.manifest.name,
      description: p.manifest.description || undefined,
      version: p.manifest.version || undefined,
      author: p.manifest.author || undefined,
      homepage: p.manifest.homepage || undefined,
    })),
  })

  const { errors, warnings } = validateMarketplace(market)
  if (errors.length) {
    console.error(
      'Generated marketplace failed validation:\n' + errors.map((e) => `  - ${e}`).join('\n'),
    )
    process.exit(1)
  }
  for (const w of warnings) console.warn(`warning: ${w}`)

  const file = join(bundledMiniAppsRoot(), MARKETPLACE_CATALOG_FILE)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(market, null, 2) + '\n')
  console.log(`Wrote ${market.plugins.length} plugins to ${file}`)
}

await main()
