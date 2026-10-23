import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import {
  PLUGIN_UI_ARTIFACT_MANIFEST,
  PLUGIN_UI_PRELOADED_MODULES,
  PLUGIN_UI_SHARED_GLOBAL,
  PLUGIN_UI_SHARED_MODULE,
  type PluginUiArtifactManifest,
} from '@localixai/mini-app-sdk/ui-artifact'

import { isPathWithin } from '../../../lib/path-containment'
import { formatBuildLogs } from './build-logs'
import type { PluginKit } from './kit'
import { PLUGIN_UI_PREBUILT_MODULES } from './kit-layout'
import { assertSafeAuthoringPaths } from './output-paths'
import { assertContainedBuildInputs } from './source-imports'
import {
  listUiArtifactFiles,
  recordCurrentHashedFiles,
  retainPreviousHashedFiles,
} from './ui-retained-files'
import { buildPluginStylesheet } from './ui-styles'
import { escapeRegExp } from '../../../lib/regexp'

/**
 * Build one plugin's workbench UI into a self-contained ES module ARTIFACT: an entry,
 * content-hashed chunks, its stylesheets and a manifest carrying a content revision.
 *
 * Why an artifact and not host source: compiled into the host, every plugin edit was an edit of
 * the app and the only way to show it was a full page reload (one build reloaded the workbench an
 * agent was running in). Built apart, a plugin is served by the API and swapped in place by the
 * host runtime. The builder lives in the app and reads only the plugin kit, so the SAME build runs
 * for a first-party plugin at staging and for a user plugin on an installed app with no source
 * tree.
 *
 * The artifact bundles its own dependencies except the shared modules (`PLUGIN_UI_SHARED_MODULE`):
 * each import of one becomes a tiny module that takes the host's instance and re-exports exactly
 * the names the kit recorded for it.
 */

const UI_ENTRIES = ['ui/register.tsx', 'ui/register.ts']
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u
const SHARED_NAMESPACE = 'localix-shared'

export function pluginUiEntry(pluginDir: string): string | null {
  return UI_ENTRIES.map((path) => join(pluginDir, path)).find((path) => existsSync(path)) ?? null
}

/**
 * The module standing in for one shared import. A module the host loads before any artifact
 * (React) is read synchronously; anything else is awaited, so it loads with the chunk that uses
 * it. The split is not cosmetic: an older CommonJS dependency `require`s React, and Bun refuses a
 * `require` whose dependency chain contains a top-level `await` anywhere.
 *
 * The awaited `load` is the ONLY top-level `await` an artifact carries, and it is safe only because
 * the host's registry never settles a load after `pagehide` (`apps/ui/src/app/pluginSharedModules.ts`):
 * WebKit resumes a module paused at a top-level `await` in a detached document by spinning forever,
 * which froze the whole app after a reload. A second kind of top-level `await` here would reopen it.
 */
export function sharedShim(specifier: string, names: readonly string[]): string {
  const named = [...new Set(names)].filter((name) => name !== 'default' && IDENTIFIER.test(name))
  const host = `globalThis[${JSON.stringify(PLUGIN_UI_SHARED_GLOBAL)}]`
  const id = JSON.stringify(specifier)
  return [
    PLUGIN_UI_PRELOADED_MODULES.includes(specifier)
      ? `const m = ${host}.require(${id})`
      : `const m = await ${host}.load(${id})`,
    named.length ? `export const { ${named.join(', ')} } = m` : '',
    'export default m.default',
  ].join('\n')
}

/** Bare specifiers the build takes from the kit: vendor packages and the prebuilt portable modules. */
function kitBundledModules(kit: PluginKit): Record<string, string> {
  const prebuilt = PLUGIN_UI_PREBUILT_MODULES.flatMap((specifier) => {
    const file = kit.manifest.backendModules[specifier]
    return file ? [[specifier, file] as const] : []
  })
  return { ...Object.fromEntries(prebuilt), ...kit.manifest.uiVendorModules }
}

/** A filter matching exactly `specifiers`, and nothing that merely starts like one. */
function exactly(specifiers: readonly string[]): RegExp {
  const escaped = specifiers.map(escapeRegExp)
  return new RegExp(`^(?:${escaped.join('|')})$`, 'u')
}

/**
 * Every callback here CLAIMS each import its filter matches, or fails the build; none matches an
 * import only to decline it. Declining is not neutral in Bun 1.3: a re-export barrel of a
 * `sideEffects: false` package, resolved after a callback declined it, is dropped — and the build
 * still succeeds, the barrel's names referenced and their definitions gone. That is how
 * `isTextItem` from `@localixai/agent/agents/items` shipped as an undeclared `E_`, on which a
 * bundled plugin's every session import failed. So each filter names exactly its modules, and every other
 * import meets Bun's own resolver, browser conditions and all, with no plugin in the way.
 */
function sharedModulesPlugin(kit: PluginKit, pluginDir: string): Bun.BunPlugin {
  const vendor = kitBundledModules(kit)
  const vendored = Object.keys(vendor)
  return {
    name: 'localix-plugin-ui-shared',
    setup(build) {
      // The boundary, enforced where it matters: host internals are never bundled into a plugin.
      // (Bun's onResolve ignores esbuild-style returned `errors`; throwing fails the build.)
      build.onResolve({ filter: /^@\// }, (args) => {
        throw new Error(
          `${relative(pluginDir, args.importer)} imports host internals ("${args.path}"); use a @localixai/kit module`,
        )
      })
      build.onResolve({ filter: PLUGIN_UI_SHARED_MODULE }, (args) => {
        if (!kit.manifest.uiSharedExports[args.path]) {
          throw new Error(
            `${relative(pluginDir, args.importer)}: the host provides no "${args.path}"`,
          )
        }
        return { path: args.path, namespace: SHARED_NAMESPACE }
      })
      if (vendored.length > 0) {
        build.onResolve({ filter: exactly(vendored) }, (args) => ({
          path: join(kit.dir, vendor[args.path]!),
        }))
      }
      build.onLoad({ filter: /.*/u, namespace: SHARED_NAMESPACE }, (args) => ({
        loader: 'js',
        contents: sharedShim(args.path, kit.manifest.uiSharedExports[args.path] ?? []),
      }))
    },
  }
}

/**
 * Move a fully built UI artifact into the served location. A failed publication restores the
 * previous artifact; callers may also use this after other plugin checks pass.
 */
export async function publishPluginUiArtifact(
  stagedDir: string,
  outDir: string,
  options: { retainPrevious?: boolean } = {},
): Promise<void> {
  await fs.mkdir(dirname(outDir), { recursive: true })
  // The new manifest and revision were already written from current files only. Carry the old
  // content-named chunks beside them before the swap so an open old view can finish lazy loads.
  if (options.retainPrevious !== false) await retainPreviousHashedFiles(outDir, stagedDir)
  const previous = join(dirname(outDir), `.${basename(outDir)}-previous-${randomUUID()}`)
  let movedPrevious = false
  try {
    await fs.rename(outDir, previous)
    movedPrevious = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await fs.rename(stagedDir, outDir)
  } catch (error) {
    // Keep the backup if restoration itself fails, so cleanup cannot destroy a good build.
    if (movedPrevious) await fs.rename(previous, outDir)
    throw error
  }
  if (movedPrevious) {
    // Publication succeeded. An old artifact that cannot be deleted is an inert hidden folder,
    // not a reason to tell the caller this build failed after the new one went live.
    await fs.rm(previous, { recursive: true, force: true }).catch(() => {})
  }
}

/** Retire a removed UI entry with one rename; cleanup cannot partly erase the live artifact. */
export async function removePluginUiArtifact(outDir: string): Promise<void> {
  const previous = join(dirname(outDir), `.${basename(outDir)}-removed-${randomUUID()}`)
  try {
    await fs.rename(outDir, previous)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  await fs.rm(previous, { recursive: true, force: true }).catch(() => {})
}

/**
 * Build `<pluginDir>`'s UI into `<outDir>` (replaced whole). Returns the manifest, or null for a
 * plugin without a UI entry. A failed build leaves the old artifact intact.
 *
 * `sourceMaps` defaults on: a user plugin is debugged in the app it is built in, from the maps
 * beside it. Release staging of the FIRST-PARTY plugins turns them off — maps of code nobody
 * debugs on a user's machine were 17 MB of the installer.
 */
export async function buildPluginUiArtifact(input: {
  kit: PluginKit
  pluginDir: string
  outDir: string
  sourceMaps?: boolean
}): Promise<PluginUiArtifactManifest | null> {
  const { kit, pluginDir, outDir, sourceMaps = true } = input
  if (isPathWithin(pluginDir, outDir)) await assertSafeAuthoringPaths(pluginDir)
  const entry = pluginUiEntry(pluginDir)
  if (!entry) {
    // A successful build of a plugin whose UI entry was removed also removes its old view.
    await removePluginUiArtifact(outDir)
    return null
  }
  // Build away from the served artifact. A syntax error or stylesheet failure must leave the
  // previous manifest, entry and chunks together; the host can keep rendering that revision.
  await fs.mkdir(dirname(outDir), { recursive: true })
  const staging = join(dirname(outDir), `.${basename(outDir)}-staging-${randomUUID()}`)
  await fs.mkdir(staging)
  try {
    const manifest = await buildStagedUiArtifact({
      kit,
      pluginDir,
      entry,
      outDir: staging,
      sourceMaps,
    })
    await publishPluginUiArtifact(staging, outDir)
    return manifest
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

async function buildStagedUiArtifact(input: {
  kit: PluginKit
  pluginDir: string
  entry: string
  outDir: string
  sourceMaps: boolean
}): Promise<PluginUiArtifactManifest> {
  const { kit, pluginDir, entry, outDir, sourceMaps } = input
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
    plugins: [sharedModulesPlugin(kit, pluginDir)],
    metafile: true,
    throw: false,
  })
  if (!result.success) {
    throw new Error(`UI build failed:\n${formatBuildLogs(result.logs, pluginDir)}`)
  }
  await assertContainedBuildInputs({
    metafile: result.metafile,
    pluginDir,
    kitDir: kit.dir,
    sharedSpecifiers: new Set(Object.keys(kit.manifest.uiSharedExports)),
    virtualInputs: new Set(
      Object.keys(kit.manifest.uiSharedExports).map((specifier) => `localix-shared:${specifier}`),
    ),
  })

  const utilities = await buildPluginStylesheet(kit, pluginDir)
  if (utilities.trim()) await fs.writeFile(join(outDir, 'utilities.css'), utilities)

  // A fixed order, so the revision hashes content, not directory-listing order.
  const files = (await listUiArtifactFiles(outDir)).sort((a, b) => a.localeCompare(b))
  const revision = createHash('sha256')
  for (const file of files) {
    revision
      .update(file)
      .update('\0')
      .update(await fs.readFile(join(outDir, file)))
  }
  const manifest: PluginUiArtifactManifest = {
    entry: 'entry.js',
    // Bundled stylesheets first (a component's own CSS), host-themed utilities last so they win.
    styles: [
      ...files.filter((file) => file.endsWith('.css') && file !== 'utilities.css'),
      ...(files.includes('utilities.css') ? ['utilities.css'] : []),
    ],
    revision: revision.digest('hex').slice(0, 16),
  }
  await fs.writeFile(
    join(outDir, PLUGIN_UI_ARTIFACT_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await recordCurrentHashedFiles(outDir, files)
  return manifest
}
