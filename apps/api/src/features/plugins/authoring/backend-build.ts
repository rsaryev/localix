import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative } from 'node:path'

import { wasImportedByThisProcess } from '../../../lib/module-url'
import { formatBuildLogs } from './build-logs'
import type { PluginKit } from './kit'
import { assertSafeAuthoringPaths } from './output-paths'
import { assertContainedBuildInputs } from './source-imports'
import {
  PLUGIN_BACKEND_SHARED_MODULES,
  USER_PLUGIN_BACKEND_DIR,
  USER_PLUGIN_BACKEND_SOURCE,
  isUserPluginBackendBuild,
} from './kit-layout'

/**
 * Build a USER plugin's backend into one self-contained module the loader imports.
 *
 * The defect it stops: a user plugin lives in `~/.localix/plugins/<name>` with no `node_modules`,
 * so importing its `backend/index.ts` directly failed on the first `import { Hono } from 'hono'`.
 * First-party plugins never hit it because staging pre-bundles them from the source tree — an
 * option an installed app does not have. The app bundles the plugin itself instead, leaving the
 * shared modules to the host (which serves its own at runtime), and `plugin.json` names the result.
 *
 * Every build is a NEW file named by its content, and the previous one is left where it is. The
 * first version renamed each build over one fixed file — the module the API had imported — and
 * replacing (or even renaming) an imported file makes the development runtime (`bun --watch`)
 * restart the whole API: one session lost its agent turn to "Backend restarted while plugin_build
 * was still running". Measured under `bun --watch`: replace-over and rename-aside both restart;
 * a new sibling file, a rewritten `plugin.json` and deleting a file nobody imported do not. So a
 * build writes `index-<hash>.mjs`, points `plugin.json` `tools` at it, and deletes only old builds
 * this process never imported. A single-file build also moves as a whole, so a changed module the
 * entry imported can no longer stay cached behind an unchanged entry URL.
 */

const BUILTIN = /^(?:node|bun):/u
const BUILD_FILE = /^index-[0-9a-f]{16}\.mjs$/u

/**
 * The shared modules stay EXTERNAL: the host serves its own instance at runtime
 * (`backend-host-modules.ts`), the same way it does for the first-party backends. Bundling the
 * kit's copy put a zod, hono and SDK into every user plugin, and made its `ZodObject` a different
 * class from the host's.
 */
function hostModulesPlugin(pluginDir: string): Bun.BunPlugin {
  const allowed = new Set(PLUGIN_BACKEND_SHARED_MODULES)
  return {
    name: 'localix-plugin-backend-shared',
    setup(build) {
      build.onResolve({ filter: /^[^./]/u }, (args) => {
        if (BUILTIN.test(args.path)) return undefined
        if (allowed.has(args.path)) return { path: args.path, external: true }
        throw new Error(
          `${relative(pluginDir, args.importer)} imports "${args.path}", which a plugin backend cannot use — available: ${PLUGIN_BACKEND_SHARED_MODULES.join(', ')}, node:* and bun:*`,
        )
      })
    },
  }
}

/** Write `bytes` under `path` atomically: the reader never sees half a file. */
async function writeAtomically(path: string, bytes: string | Uint8Array): Promise<void> {
  const temp = `${path}.${process.pid}-${randomUUID()}.tmp`
  try {
    await Bun.write(temp, bytes)
    await fs.rename(temp, path)
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}

/** Pruning is inert cleanup after both backend and UI have been published. */
export async function prunePluginBackendBuilds(
  pluginDir: string,
  tools: string | null,
): Promise<void> {
  const outDir = join(pluginDir, USER_PLUGIN_BACKEND_DIR)
  for (const file of await fs.readdir(outDir).catch(() => [])) {
    const path = join(outDir, file)
    if (tools?.endsWith(`/${file}`) || !BUILD_FILE.test(file) || wasImportedByThisProcess(path))
      continue
    // Pruning is housekeeping after the manifest has already gone live. A locked old file on
    // Windows must not turn a successful publication into a reported failure.
    await fs.rm(path, { force: true }).catch(() => {})
  }
}

/** Drop a candidate whose manifest never advanced; repeated failed edits cannot fill dist. */
export async function discardPluginBackendCandidate(
  pluginDir: string,
  tools: string | null,
): Promise<void> {
  if (!tools) return
  // A malformed manifest is itself a failed check. It must not mask the report or leave every
  // failed candidate on disk; only a manifest that actually names this build protects it.
  const manifest = await fs
    .readFile(join(pluginDir, 'plugin.json'), 'utf8')
    .then((text) => JSON.parse(text) as { tools?: unknown })
    .catch(() => null)
  if (manifest?.tools === tools) return
  const path = join(pluginDir, tools)
  if (!wasImportedByThisProcess(path)) await fs.rm(path, { force: true }).catch(() => {})
}

/** Point the manifest at a checked build, then prune builds this process has never loaded. */
export async function publishPluginBackend(
  pluginDir: string,
  tools: string | null,
  options: { prune?: boolean } = {},
): Promise<void> {
  const manifestPath = join(pluginDir, 'plugin.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
  const next = { ...manifest }
  if (tools) next.tools = tools
  else if (isUserPluginBackendBuild(next.tools)) delete next.tools
  if (next.tools !== manifest.tools) {
    await writeAtomically(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  }

  if (options.prune !== false) await prunePluginBackendBuilds(pluginDir, tools)
}

/**
 * Build `<pluginDir>/backend/index.ts`. A candidate stays unreferenced until checks pass; the
 * default direct call publishes it for repository staging and callers that already validated it.
 */
export async function buildPluginBackend(input: {
  kit: PluginKit
  pluginDir: string
  publish?: boolean
}): Promise<string | null> {
  const { kit, pluginDir } = input
  await assertSafeAuthoringPaths(pluginDir)
  const entry = join(pluginDir, USER_PLUGIN_BACKEND_SOURCE)
  if (!(await fs.stat(entry).catch(() => null))) {
    if (input.publish !== false) await publishPluginBackend(pluginDir, null)
    return null
  }
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    packages: 'bundle',
    plugins: [hostModulesPlugin(pluginDir)],
    metafile: true,
    throw: false,
  })
  const output = result.outputs[0]
  if (!result.success || !output) {
    throw new Error(`Backend build failed:\n${formatBuildLogs(result.logs, pluginDir)}`)
  }
  await assertContainedBuildInputs({
    metafile: result.metafile,
    pluginDir,
    kitDir: kit.dir,
    sharedSpecifiers: new Set(PLUGIN_BACKEND_SHARED_MODULES),
  })

  const bytes = new Uint8Array(await output.arrayBuffer())
  const name = `index-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.mjs`
  const outDir = join(pluginDir, USER_PLUGIN_BACKEND_DIR)
  await fs.mkdir(outDir, { recursive: true })
  const outFile = join(outDir, name)
  // Same content, same name: an unchanged build touches nothing.
  const existing = await fs.lstat(outFile).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!existing) await writeAtomically(outFile, bytes)
  else if (
    !existing.isFile() ||
    existing.isSymbolicLink() ||
    !(await fs.readFile(outFile)).equals(Buffer.from(bytes))
  ) {
    throw new Error(`Backend build ${name} exists with different content or file type`)
  }

  const tools = `./${USER_PLUGIN_BACKEND_DIR}/${name}`
  if (input.publish !== false) await publishPluginBackend(pluginDir, tools)
  return tools
}
