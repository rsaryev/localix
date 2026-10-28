// CLI for one mini app UI artifact:
// `bun scripts/build-mini-app-ui.mjs <miniAppDir> <outDir> <kitDir> [--no-source-maps]`.
// Staging runs it as a child, like `bun build` for the backend, so its synchronous pipeline stays
// synchronous and a build error prints the bundler's own diagnostics. The builder is the
// mini-app-authoring plugin's and reads only the mini app kit, so a first-party mini app is built
// exactly the way a person's is. The plugin imports nothing of this repository; this tooling
// importing the plugin is the one direction allowed. `--no-source-maps` is release staging's: maps
// of code nobody debugs on a user's machine were 17 MB of the installer.
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { retainPreviousHashedFiles } from '../apps/api/src/features/mini-apps/ui-retained-files.ts'
import { buildMiniAppUi } from '../plugins/mini-app-authoring/src/build/ui-build.ts'
import { loadKit } from '../plugins/mini-app-authoring/src/kit/kit.ts'

import { NO_SOURCE_MAPS_FLAG } from './stage-mini-app-ui.mjs'

/**
 * Swap a built artifact in for the one at `target`, carrying the replaced one's hashed chunks
 * over so an open tab's lazy imports still load; a failed swap puts the previous one back.
 */
export async function publishMiniAppUi(staging, target) {
  const previous = join(dirname(target), `.${basename(target)}-previous-${randomUUID()}`)
  await retainPreviousHashedFiles(target, staging)
  const hadPrevious = await fs.rename(target, previous).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false
      throw error
    },
  )
  try {
    await fs.rename(staging, target)
  } catch (error) {
    if (hadPrevious) await fs.rename(previous, target)
    throw error
  }
  if (hadPrevious) await fs.rm(previous, { recursive: true, force: true })
}

/**
 * Build `miniAppDir`'s UI aside and swap it in at `outDir`. A failed build leaves the artifact a
 * view is rendering; a mini app whose UI entry is gone loses its old artifact.
 */
export async function buildAndPublishMiniAppUi({ kit, miniAppDir, outDir, sourceMaps = true }) {
  const target = resolve(outDir)
  await fs.mkdir(dirname(target), { recursive: true })
  const staging = join(dirname(target), `.${basename(target)}-staging-${randomUUID()}`)
  try {
    const manifest = await buildMiniAppUi({ kit, miniAppDir, outDir: staging, sourceMaps })
    if (manifest) await publishMiniAppUi(staging, target)
    else await fs.rm(target, { recursive: true, force: true })
    return manifest
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const [miniAppDir, outDir, kitDir] = args.filter((arg) => arg !== NO_SOURCE_MAPS_FLAG)
  if (!miniAppDir || !outDir || !kitDir) {
    console.error(
      `Usage: bun scripts/build-mini-app-ui.mjs <miniAppDir> <outDir> <kitDir> [${NO_SOURCE_MAPS_FLAG}]`,
    )
    process.exit(2)
  }
  try {
    const manifest = await buildAndPublishMiniAppUi({
      kit: await loadKit(resolve(kitDir)),
      miniAppDir: resolve(miniAppDir),
      outDir,
      sourceMaps: !args.includes(NO_SOURCE_MAPS_FLAG),
    })
    if (manifest) console.log(`[mini-app-ui] built ${miniAppDir} (revision ${manifest.revision})`)
  } catch (error) {
    console.error(`[mini-app-ui] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
