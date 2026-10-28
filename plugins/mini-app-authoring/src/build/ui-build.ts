import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { Kit } from '../kit/kit'
import { formatBuildLogs } from './build-logs'
import { assertContainedBuildInputs } from './source-imports'
import { assertSharedShimsExported } from './ui-shared-check'
import { sharedModulesPlugin } from './ui-shared-modules'
import { buildMiniAppStylesheet } from './ui-styles'

/**
 * Build one mini app's workbench UI into a self-contained ES module ARTIFACT: an entry,
 * content-hashed chunks, its stylesheets and a manifest carrying a content revision. Localix serves
 * it and swaps a new revision into an open view in place.
 *
 * The artifact bundles its own dependencies except the shared modules (the kit's
 * `tools.ui.sharedModule`): each import of one becomes a tiny module that takes the host's instance
 * and re-exports exactly the names the kit recorded for it.
 */

const UI_ENTRIES = ['ui/register.tsx', 'ui/register.ts']
/**
 * The hashed files this revision emitted. Localix keeps the previous revision's files beside a new
 * one when it installs it, so a view still open on the old revision can finish its lazy imports;
 * this list is how it tells the two apart.
 */
const CURRENT_FILES = '.current-files.json'

export interface UiArtifactManifest {
  entry: string
  styles: string[]
  revision: string
}

export function miniAppUiEntry(miniAppDir: string): string | null {
  return UI_ENTRIES.map((path) => join(miniAppDir, path)).find((path) => existsSync(path)) ?? null
}

async function listFiles(dir: string, base: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory()
        ? listFiles(path, base)
        : [relative(base, path).split('\\').join('/')]
    }),
  )
  return nested.flat()
}

const isHashedFile = (file: string) => file.startsWith('chunks/') || file.startsWith('assets/')

/**
 * Build `<miniAppDir>`'s UI into `outDir`, which must not exist yet. Returns the manifest, or null
 * for a mini app without a UI entry.
 *
 * `sourceMaps` defaults on: a mini app is debugged where it is built. A catalog release may turn
 * them off.
 */
export async function buildMiniAppUi(input: {
  kit: Kit
  miniAppDir: string
  outDir: string
  sourceMaps?: boolean
}): Promise<UiArtifactManifest | null> {
  const { kit, miniAppDir, outDir, sourceMaps = true } = input
  const entry = miniAppUiEntry(miniAppDir)
  if (!entry) return null
  await fs.mkdir(dirname(outDir), { recursive: true })
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    root: dirname(entry),
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    sourcemap: sourceMaps ? 'linked' : 'none',
    naming: {
      entry: 'entry.[ext]',
      chunk: 'chunks/[name]-[hash].[ext]',
      asset: 'assets/[name]-[hash].[ext]',
    },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [sharedModulesPlugin(kit, miniAppDir)],
    metafile: true,
    throw: false,
  })
  if (!result.success) {
    throw new Error(`UI build failed:\n${formatBuildLogs(result.logs, miniAppDir)}`)
  }
  await assertContainedBuildInputs({
    metafile: result.metafile,
    miniAppDir,
    kitDir: kit.dir,
    sharedSpecifiers: new Set(Object.keys(kit.manifest.uiSharedExports)),
    virtualInputs: new Set(
      Object.keys(kit.manifest.uiSharedExports).map((specifier) => `localix-shared:${specifier}`),
    ),
  })

  const scripts = (await listFiles(outDir)).filter((file) => file.endsWith('.js'))
  assertSharedShimsExported(
    new Map(
      await Promise.all(
        scripts.map(async (file) => [file, await fs.readFile(join(outDir, file), 'utf8')] as const),
      ),
    ),
    kit.tools.ui.sharedGlobal,
  )

  const utilities = await buildMiniAppStylesheet(kit, miniAppDir)
  if (utilities.trim()) await fs.writeFile(join(outDir, 'utilities.css'), utilities)

  // A fixed order, so the revision hashes content, not directory-listing order.
  const files = (await listFiles(outDir)).sort((a, b) => a.localeCompare(b))
  const revision = createHash('sha256')
  for (const file of files) {
    revision
      .update(file)
      .update('\0')
      .update(await fs.readFile(join(outDir, file)))
  }
  const manifest: UiArtifactManifest = {
    entry: 'entry.js',
    // Bundled stylesheets first (a component's own CSS), host-themed utilities last so they win.
    styles: [
      ...files.filter((file) => file.endsWith('.css') && file !== 'utilities.css'),
      ...(files.includes('utilities.css') ? ['utilities.css'] : []),
    ],
    revision: revision.digest('hex').slice(0, 16),
  }
  await fs.writeFile(
    join(outDir, kit.tools.ui.artifactManifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await fs.writeFile(join(outDir, CURRENT_FILES), `${JSON.stringify(files.filter(isHashedFile))}\n`)
  return manifest
}
