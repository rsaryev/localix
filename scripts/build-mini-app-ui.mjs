// CLI for one mini app UI artifact:
// `bun scripts/build-mini-app-ui.mjs <miniAppDir> <outDir> <kitDir> [--no-source-maps]`.
// Staging runs it as a child, like `bun build` for the backend, so its synchronous pipeline stays
// synchronous and a build error prints the bundler's own diagnostics. The builder is the app's own
// (`@localixai/api/mini-app-ui-build`) and reads only the mini app kit, so a first-party mini app
// is built exactly the way the installed app builds a user mini app. `--no-source-maps` is release
// staging's: see `buildMiniAppUiArtifact`.
import { resolve } from 'node:path'

import { loadMiniAppKit } from '@localixai/api/mini-app-kit'
import { buildMiniAppUiArtifact } from '@localixai/api/mini-app-ui-build'

import { NO_SOURCE_MAPS_FLAG } from './stage-mini-app-ui.mjs'

const args = process.argv.slice(2)
const [miniAppDir, outDir, kitDir] = args.filter((arg) => arg !== NO_SOURCE_MAPS_FLAG)
if (!miniAppDir || !outDir || !kitDir) {
  console.error(
    `Usage: bun scripts/build-mini-app-ui.mjs <miniAppDir> <outDir> <kitDir> [${NO_SOURCE_MAPS_FLAG}]`,
  )
  process.exit(2)
}
try {
  const manifest = await buildMiniAppUiArtifact({
    kit: await loadMiniAppKit(resolve(kitDir)),
    miniAppDir: resolve(miniAppDir),
    outDir: resolve(outDir),
    sourceMaps: !args.includes(NO_SOURCE_MAPS_FLAG),
  })
  if (manifest) console.log(`[mini-app-ui] built ${miniAppDir} (revision ${manifest.revision})`)
} catch (error) {
  console.error(`[mini-app-ui] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
