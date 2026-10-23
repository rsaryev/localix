import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import { wasImportedByThisProcess } from '../../../lib/module-url'
import { backendPointer, readPointerManifest } from '../backend-pointer'
import { formatBuildLogs } from './build-logs'
import type { MiniAppKit } from './kit'
import { assertSafeAuthoringPaths } from './output-paths'
import { assertContainedBuildInputs } from './source-imports'
import {
  MINI_APP_BACKEND_SHARED_MODULES,
  USER_MINI_APP_BACKEND_DIR,
  USER_MINI_APP_BACKEND_SOURCE,
  isUserMiniAppBackendBuild,
} from './kit-layout'

/**
 * Build a USER mini app's backend into one self-contained module the loader imports.
 *
 * The defect it stops: a user's mini app lives in `~/.localix/mini-apps/<name>` with no `node_modules`,
 * so importing its `backend/index.ts` directly failed on the first `import { Hono } from 'hono'`.
 * First-party mini apps never hit it because staging pre-bundles them from the source tree — an
 * option an installed app does not have. The app bundles the mini app itself instead, leaving the
 * shared modules to the host (which serves its own at runtime), and the mini app manifest names the
 * result (the `backend` field of `mini-app.json`; see `backend-pointer.ts`).
 *
 * Every build is a NEW file named by its content, and the previous one is left where it is. The
 * first version renamed each build over one fixed file — the module the API had imported — and
 * replacing (or even renaming) an imported file makes the development runtime (`bun --watch`)
 * restart the whole API: one session lost its agent turn to "Backend restarted while mini_app_build
 * was still running". Measured under `bun --watch`: replace-over and rename-aside both restart;
 * a new sibling file, a rewritten manifest and deleting a file nobody imported do not. So a
 * build writes `index-<hash>.mjs`, points the manifest's backend at it, and deletes only old builds
 * this process never imported. A single-file build also moves as a whole, so a changed module the
 * entry imported can no longer stay cached behind an unchanged entry URL.
 */

const BUILTIN = /^(?:node|bun):/u
const BUILD_FILE = /^index-[0-9a-f]{16}\.mjs$/u

/**
 * The shared modules stay EXTERNAL: the host serves its own instance at runtime
 * (`backend-host-modules.ts`), the same way it does for the first-party backends. Bundling the
 * kit's copy put a zod, hono and SDK into every user mini app, and made its `ZodObject` a different
 * class from the host's.
 */
function hostModulesPlugin(miniAppDir: string): Bun.BunPlugin {
  const allowed = new Set(MINI_APP_BACKEND_SHARED_MODULES)
  return {
    name: 'localix-mini-app-backend-shared',
    setup(build) {
      build.onResolve({ filter: /^[^./]/u }, (args) => {
        if (BUILTIN.test(args.path)) return undefined
        if (allowed.has(args.path)) return { path: args.path, external: true }
        throw new Error(
          `${relative(miniAppDir, args.importer)} imports "${args.path}", which a mini app backend cannot use — available: ${MINI_APP_BACKEND_SHARED_MODULES.join(', ')}, node:* and bun:*`,
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
export async function pruneMiniAppBackendBuilds(
  miniAppDir: string,
  tools: string | null,
): Promise<void> {
  const outDir = join(miniAppDir, USER_MINI_APP_BACKEND_DIR)
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
export async function discardMiniAppBackendCandidate(
  miniAppDir: string,
  tools: string | null,
): Promise<void> {
  if (!tools) return
  // A malformed manifest is itself a failed check. It must not mask the report or leave every
  // failed candidate on disk; only a manifest that actually names this build protects it.
  const pointer = await backendPointer(miniAppDir)
  const manifest = await fs
    .readFile(pointer.path, 'utf8')
    .then((text) => JSON.parse(text) as Record<string, unknown>)
    .catch(() => null)
  if (manifest?.[pointer.field] === tools) return
  const path = join(miniAppDir, tools)
  if (!wasImportedByThisProcess(path)) await fs.rm(path, { force: true }).catch(() => {})
}

/** Point the manifest at a checked build, then prune builds this process has never loaded. */
export async function publishMiniAppBackend(
  miniAppDir: string,
  tools: string | null,
  options: { prune?: boolean } = {},
): Promise<void> {
  const pointer = await backendPointer(miniAppDir)
  const manifest = await readPointerManifest(miniAppDir, pointer)
  const next = { ...manifest }
  if (tools) next[pointer.field] = tools
  else if (isUserMiniAppBackendBuild(next[pointer.field])) delete next[pointer.field]
  if (next[pointer.field] !== manifest[pointer.field]) {
    await fs.mkdir(dirname(pointer.path), { recursive: true })
    await writeAtomically(pointer.path, `${JSON.stringify(next, null, 2)}\n`)
  }

  if (options.prune !== false) await pruneMiniAppBackendBuilds(miniAppDir, tools)
}

/**
 * Build `<miniAppDir>/backend/index.ts`. A candidate stays unreferenced until checks pass; the
 * default direct call publishes it for repository staging and callers that already validated it.
 */
export async function buildMiniAppBackend(input: {
  kit: MiniAppKit
  miniAppDir: string
  publish?: boolean
}): Promise<string | null> {
  const { kit, miniAppDir } = input
  await assertSafeAuthoringPaths(miniAppDir)
  const entry = join(miniAppDir, USER_MINI_APP_BACKEND_SOURCE)
  if (!(await fs.stat(entry).catch(() => null))) {
    if (input.publish !== false) await publishMiniAppBackend(miniAppDir, null)
    return null
  }
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    packages: 'bundle',
    plugins: [hostModulesPlugin(miniAppDir)],
    metafile: true,
    throw: false,
  })
  const output = result.outputs[0]
  if (!result.success || !output) {
    throw new Error(`Backend build failed:\n${formatBuildLogs(result.logs, miniAppDir)}`)
  }
  await assertContainedBuildInputs({
    metafile: result.metafile,
    miniAppDir,
    kitDir: kit.dir,
    sharedSpecifiers: new Set(MINI_APP_BACKEND_SHARED_MODULES),
  })

  const bytes = new Uint8Array(await output.arrayBuffer())
  const name = `index-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.mjs`
  const outDir = join(miniAppDir, USER_MINI_APP_BACKEND_DIR)
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

  const tools = `./${USER_MINI_APP_BACKEND_DIR}/${name}`
  if (input.publish !== false) await publishMiniAppBackend(miniAppDir, tools)
  return tools
}
