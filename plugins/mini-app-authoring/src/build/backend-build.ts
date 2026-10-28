import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { join, relative } from 'node:path'

import type { Kit } from '../kit/kit'
import { resolveWithin } from '../lib/paths'
import { formatBuildLogs } from './build-logs'
import { assertContainedBuildInputs } from './source-imports'

/**
 * Build a mini app's backend into one self-contained module the host imports.
 *
 * A mini app has no `node_modules` where it is installed, so its backend is bundled with every
 * dependency except the modules the host serves at runtime (`authoring.backendSharedModules` in the
 * kit): those stay EXTERNAL, so a mini app's zod and Hono are the host's own objects. Any other bare
 * import a mini app's own files make is refused with the list of what is available.
 *
 * The output is named by its content (`index-<hash>.mjs`). The host imports a new file for a new
 * build, so a changed module can never stay cached behind an unchanged URL.
 */

const BUILTIN = /^(?:node|bun):/u
export const BACKEND_SOURCE = 'backend/index.ts'
export const BACKEND_OUT_DIR = 'dist/backend'

/**
 * The backend source a manifest names (`backend`: a `.ts`/`.tsx` file in the folder), else the
 * conventional `backend/index.ts`, else none.
 */
export function backendSource(
  miniAppDir: string,
  manifest: Record<string, unknown>,
): string | null {
  const declared = manifest.backend
  if (typeof declared === 'string' && /\.[cm]?tsx?$/u.test(declared)) {
    const path = resolveWithin(miniAppDir, declared)
    if (!path) throw new Error(`mini-app.json names a backend outside the folder: ${declared}`)
    return existsSync(path) ? path : null
  }
  const conventional = join(miniAppDir, BACKEND_SOURCE)
  return existsSync(conventional) ? conventional : null
}

function hostModulesPlugin(kit: Kit, miniAppDir: string): Bun.BunPlugin {
  const shared = kit.manifest.authoring.backendSharedModules
  const allowed = new Set(shared)
  return {
    name: 'localix-mini-app-backend-shared',
    setup(build) {
      build.onResolve({ filter: /^[^./]/u }, (args) => {
        if (BUILTIN.test(args.path)) return undefined
        if (allowed.has(args.path)) return { path: args.path, external: true }
        throw new Error(
          `${relative(miniAppDir, args.importer)} imports "${args.path}", which a mini app backend cannot use — available: ${shared.join(', ')}, node:* and bun:*`,
        )
      })
    },
  }
}

/**
 * Build `entry` into `<outRoot>/dist/backend/index-<hash>.mjs`. Returns the manifest's `backend`
 * value for the build (`./dist/backend/index-<hash>.mjs`).
 */
export async function buildMiniAppBackend(input: {
  kit: Kit
  miniAppDir: string
  entry: string
  outRoot: string
}): Promise<string> {
  const { kit, miniAppDir, entry, outRoot } = input
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    packages: 'bundle',
    plugins: [hostModulesPlugin(kit, miniAppDir)],
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
    sharedSpecifiers: new Set(kit.manifest.authoring.backendSharedModules),
  })
  const bytes = new Uint8Array(await output.arrayBuffer())
  const name = `index-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.mjs`
  const outDir = join(outRoot, BACKEND_OUT_DIR)
  await fs.mkdir(outDir, { recursive: true })
  await Bun.write(join(outDir, name), bytes)
  return `./${BACKEND_OUT_DIR}/${name}`
}
