// The staging step for a plugin's UI artifact: build it into the staged copy, beside the backend
// bundle, so the copy that reaches `~/.localix/plugins` carries its UI the same way in development
// and in a release.
//
// A failed UI build costs the plugin its UI UPDATE, never the plugin. A backend that fails to
// bundle removes the plugin (it cannot run); a UI that fails to build is usually a file an agent
// or a person is halfway through. Removing the plugin for that would take its backend and tools
// down mid-edit, so a re-stage keeps the artifact that last built, and a fresh stage ships the
// plugin without UI. Under `fatal` (release staging) a failure still stops the build.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLUGIN_KIT_DIR_NAME } from '@localixai/api/plugin-kit-layout'
import { pluginUiEntry } from '@localixai/api/plugin-ui-build'
import { PLUGIN_UI_ARTIFACT_DIR } from '@localixai/plugin-sdk/ui-artifact'

const BUILDER_CLI = fileURLToPath(new URL('./build-plugin-ui.mjs', import.meta.url))
/** The builder CLI's switch for an artifact without source maps (release staging). */
export const NO_SOURCE_MAPS_FLAG = '--no-source-maps'

/** The plugin kit staged beside `outPlugins` — where the running app finds it too. */
export const pluginKitDirOf = (outPlugins) => join(dirname(outPlugins), PLUGIN_KIT_DIR_NAME)

/**
 * Move a staged plugin's current artifact aside before its directory is replaced. The holding
 * directory sits beside the plugins (a `.`-prefixed name discovery and the marker ignore).
 */
export function takeStagedUiArtifact(stagedPlugin) {
  const artifact = join(stagedPlugin, PLUGIN_UI_ARTIFACT_DIR)
  if (!existsSync(artifact)) return null
  const kept = join(mkdtempSync(join(dirname(stagedPlugin), '.ui-previous-')), 'ui')
  renameSync(artifact, kept)
  return kept
}

/** Drop what {@link takeStagedUiArtifact} set aside. */
export function discardStagedUiArtifact(previous) {
  if (previous) rmSync(dirname(previous), { recursive: true, force: true })
}

/**
 * Build `<repoRoot>/plugins/<name>`'s UI into `<outPlugins>/<name>/dist/ui`. Returns a skip record
 * when the build failed under `skip`, null otherwise. `previous` is what
 * {@link takeStagedUiArtifact} set aside: put back on failure, discarded otherwise.
 * `uiSourceMaps: false` builds without maps (release staging; development keeps them).
 */
export function stagePluginUi(
  name,
  {
    repoRoot,
    outPlugins,
    log,
    onPluginError,
    previous = null,
    run = execFileSync,
    uiSourceMaps = true,
  },
) {
  const pluginDir = join(repoRoot, 'plugins', name)
  const artifact = join(outPlugins, name, PLUGIN_UI_ARTIFACT_DIR)
  if (!pluginUiEntry(pluginDir) || !existsSync(join(outPlugins, name))) {
    discardStagedUiArtifact(previous)
    return null
  }
  log(`building ${name} UI…`)
  try {
    const args = [BUILDER_CLI, pluginDir, artifact, pluginKitDirOf(outPlugins)]
    if (!uiSourceMaps) args.push(NO_SOURCE_MAPS_FLAG)
    run('bun', args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    discardStagedUiArtifact(previous)
    return null
  } catch (error) {
    if (onPluginError === 'fatal') {
      discardStagedUiArtifact(previous)
      throw error
    }
    rmSync(artifact, { recursive: true, force: true })
    if (previous) {
      mkdirSync(dirname(artifact), { recursive: true })
      renameSync(previous, artifact)
    }
    discardStagedUiArtifact(previous)
    log(
      previous
        ? `${name} UI failed to build — keeping the UI that last built (fix the error above)`
        : `${name} UI failed to build — the plugin runs without its UI this run`,
    )
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return { name, reason }
  }
}
