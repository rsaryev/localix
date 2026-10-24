import { createHash, randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import {
  MINI_APP_UI_ARTIFACT_MANIFEST,
  MINI_APP_UI_PRELOADED_MODULES,
  MINI_APP_UI_SHARED_GLOBAL,
  MINI_APP_UI_SHARED_MODULE,
  type MiniAppUiArtifactManifest,
} from '@localixai/mini-app-sdk/ui-artifact'

import { isPathWithin } from '../../../lib/path-containment'
import { formatBuildLogs } from './build-logs'
import type { MiniAppKit } from './kit'
import { MINI_APP_UI_PREBUILT_MODULES } from './kit-layout'
import { assertSafeAuthoringPaths } from './output-paths'
import { assertContainedBuildInputs } from './source-imports'
import {
  listUiArtifactFiles,
  recordCurrentHashedFiles,
  retainPreviousHashedFiles,
} from './ui-retained-files'
import { assertSharedShimsExported } from './ui-shared-check'
import { buildMiniAppStylesheet } from './ui-styles'
import { escapeRegExp } from '../../../lib/regexp'

/**
 * Build one mini app's workbench UI into a self-contained ES module ARTIFACT: an entry,
 * content-hashed chunks, its stylesheets and a manifest carrying a content revision.
 *
 * Why an artifact and not host source: compiled into the host, every mini app edit was an edit of
 * the app and the only way to show it was a full page reload (one build reloaded the workbench an
 * agent was running in). Built apart, a mini app is served by the API and swapped in place by the
 * host runtime. The builder lives in the app and reads only the mini app kit, so the SAME build
 * runs for a first-party mini app at staging and for a user mini app on an installed app with no
 * source tree.
 *
 * The artifact bundles its own dependencies except the shared modules (`MINI_APP_UI_SHARED_MODULE`):
 * each import of one becomes a tiny module that takes the host's instance and re-exports exactly
 * the names the kit recorded for it.
 */

const UI_ENTRIES = ['ui/register.tsx', 'ui/register.ts']
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u
const SHARED_NAMESPACE = 'localix-shared'

export function miniAppUiEntry(miniAppDir: string): string | null {
  return UI_ENTRIES.map((path) => join(miniAppDir, path)).find((path) => existsSync(path)) ?? null
}

/**
 * The module standing in for one shared import. A module the host loads before any artifact
 * (React) is read synchronously; anything else is awaited, so it loads with the chunk that uses
 * it. The split is not cosmetic: an older CommonJS dependency `require`s React, and Bun refuses a
 * `require` whose dependency chain contains a top-level `await` anywhere.
 *
 * The preloaded shims are CommonJS (`module.exports`), not ESM. Bun treats a module resolved to
 * `react` (or `react-dom`, `react/jsx-runtime`) as the CommonJS package it usually is: a DEFAULT
 * import of it — zustand's `import React from 'react'` — wrapped an ESM shim in a CommonJS
 * function that kept its `export const { … }` as locals and exported nothing, so the Git mini
 * app's UI loaded React from an empty object ("createContext is not a function"). A CommonJS shim
 * is what Bun expects there, and it serves a default, named, namespace or `require` import alike.
 * `__esModule` keeps a default import the host's `default`, as the ESM shim gave it; the build
 * fails on a shim that lost its exports anyway (`assertSharedShimsExported`).
 *
 * The awaited `load` is the ONLY top-level `await` an artifact carries, and it is safe only because
 * the host's registry never settles a load after `pagehide`
 * (`apps/ui/src/app/miniAppSharedModules.ts`): WebKit resumes a module paused at a top-level
 * `await` in a detached document by spinning forever, which froze the whole app after a reload. A
 * second kind of top-level `await` here would reopen it.
 */
export function sharedShim(specifier: string, names: readonly string[]): string {
  const named = [...new Set(names)].filter((name) => name !== 'default' && IDENTIFIER.test(name))
  const host = `globalThis[${JSON.stringify(MINI_APP_UI_SHARED_GLOBAL)}]`
  const id = JSON.stringify(specifier)
  if (MINI_APP_UI_PRELOADED_MODULES.includes(specifier)) {
    const fields = ['__esModule: true', 'default: m.default', ...named.map((n) => `${n}: m.${n}`)]
    return [`const m = ${host}.require(${id})`, `module.exports = { ${fields.join(', ')} }`].join(
      '\n',
    )
  }
  return [
    `const m = await ${host}.load(${id})`,
    named.length ? `export const { ${named.join(', ')} } = m` : '',
    'export default m.default',
  ].join('\n')
}

/** Bare specifiers the build takes from the kit: vendor packages and the prebuilt portable modules. */
function kitBundledModules(kit: MiniAppKit): Record<string, string> {
  const prebuilt = MINI_APP_UI_PREBUILT_MODULES.flatMap((specifier) => {
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
 * bundled mini app's every session import failed. So each filter names exactly its modules, and
 * every other import meets Bun's own resolver, browser conditions and all, with no mini app in the
 * way.
 */
function sharedModulesPlugin(kit: MiniAppKit, miniAppDir: string): Bun.BunPlugin {
  const vendor = kitBundledModules(kit)
  const vendored = Object.keys(vendor)
  return {
    name: 'localix-mini-app-ui-shared',
    setup(build) {
      // The boundary, enforced where it matters: host internals are never bundled into a mini app.
      // (Bun's onResolve ignores esbuild-style returned `errors`; throwing fails the build.)
      build.onResolve({ filter: /^@\// }, (args) => {
        throw new Error(
          `${relative(miniAppDir, args.importer)} imports host internals ("${args.path}"); use a @localixai/kit module`,
        )
      })
      build.onResolve({ filter: MINI_APP_UI_SHARED_MODULE }, (args) => {
        if (!kit.manifest.uiSharedExports[args.path]) {
          throw new Error(
            `${relative(miniAppDir, args.importer)}: the host provides no "${args.path}"`,
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
 * previous artifact; callers may also use this after other mini app checks pass.
 */
export async function publishMiniAppUiArtifact(
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
export async function removeMiniAppUiArtifact(outDir: string): Promise<void> {
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
 * Build `<miniAppDir>`'s UI into `<outDir>` (replaced whole). Returns the manifest, or null for a
 * mini app without a UI entry. A failed build leaves the old artifact intact.
 *
 * `sourceMaps` defaults on: a user mini app is debugged in the app it is built in, from the maps
 * beside it. Release staging of the FIRST-PARTY mini apps turns them off — maps of code nobody
 * debugs on a user's machine were 17 MB of the installer.
 */
export async function buildMiniAppUiArtifact(input: {
  kit: MiniAppKit
  miniAppDir: string
  outDir: string
  sourceMaps?: boolean
}): Promise<MiniAppUiArtifactManifest | null> {
  const { kit, miniAppDir, outDir, sourceMaps = true } = input
  if (isPathWithin(miniAppDir, outDir)) await assertSafeAuthoringPaths(miniAppDir)
  const entry = miniAppUiEntry(miniAppDir)
  if (!entry) {
    // A successful build of a mini app whose UI entry was removed also removes its old view.
    await removeMiniAppUiArtifact(outDir)
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
      miniAppDir,
      entry,
      outDir: staging,
      sourceMaps,
    })
    await publishMiniAppUiArtifact(staging, outDir)
    return manifest
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

async function buildStagedUiArtifact(input: {
  kit: MiniAppKit
  miniAppDir: string
  entry: string
  outDir: string
  sourceMaps: boolean
}): Promise<MiniAppUiArtifactManifest> {
  const { kit, miniAppDir, entry, outDir, sourceMaps } = input
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

  const scripts = (await listUiArtifactFiles(outDir)).filter((file) => file.endsWith('.js'))
  assertSharedShimsExported(
    new Map(
      await Promise.all(
        scripts.map(async (file) => [file, await fs.readFile(join(outDir, file), 'utf8')] as const),
      ),
    ),
  )

  const utilities = await buildMiniAppStylesheet(kit, miniAppDir)
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
  const manifest: MiniAppUiArtifactManifest = {
    entry: 'entry.js',
    // Bundled stylesheets first (a component's own CSS), host-themed utilities last so they win.
    styles: [
      ...files.filter((file) => file.endsWith('.css') && file !== 'utilities.css'),
      ...(files.includes('utilities.css') ? ['utilities.css'] : []),
    ],
    revision: revision.digest('hex').slice(0, 16),
  }
  await fs.writeFile(
    join(outDir, MINI_APP_UI_ARTIFACT_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  await recordCurrentHashedFiles(outDir, files)
  return manifest
}
