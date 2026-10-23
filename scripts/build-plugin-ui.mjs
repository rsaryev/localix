// CLI for one plugin UI artifact:
// `bun scripts/build-plugin-ui.mjs <pluginDir> <outDir> <kitDir> [--no-source-maps]`.
// Staging runs it as a child, like `bun build` for the backend, so its synchronous pipeline stays
// synchronous and a build error prints the bundler's own diagnostics. The builder is the app's own
// (`@localixai/api/plugin-ui-build`) and reads only the plugin kit, so a first-party plugin is
// built exactly the way the installed app builds a user plugin. `--no-source-maps` is release
// staging's: see `buildMiniAppUiArtifact`.
import { resolve } from 'node:path'

import { loadMiniAppKit } from '@localixai/api/plugin-kit'
import { buildMiniAppUiArtifact } from '@localixai/api/plugin-ui-build'

import { NO_SOURCE_MAPS_FLAG } from './stage-plugin-ui.mjs'

const args = process.argv.slice(2)
const [pluginDir, outDir, kitDir] = args.filter((arg) => arg !== NO_SOURCE_MAPS_FLAG)
if (!pluginDir || !outDir || !kitDir) {
  console.error(
    `Usage: bun scripts/build-plugin-ui.mjs <pluginDir> <outDir> <kitDir> [${NO_SOURCE_MAPS_FLAG}]`,
  )
  process.exit(2)
}
try {
  const manifest = await buildMiniAppUiArtifact({
    kit: await loadMiniAppKit(resolve(kitDir)),
    pluginDir: resolve(pluginDir),
    outDir: resolve(outDir),
    sourceMaps: !args.includes(NO_SOURCE_MAPS_FLAG),
  })
  if (manifest) console.log(`[plugin-ui] built ${pluginDir} (revision ${manifest.revision})`)
} catch (error) {
  console.error(`[plugin-ui] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
