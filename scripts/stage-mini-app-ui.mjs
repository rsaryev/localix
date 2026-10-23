// The staging step for a mini app's UI artifact: build it into the staged copy, beside the backend
// bundle, so the copy that reaches `~/.localix/mini-apps` carries its UI the same way in development
// and in a release.
//
// A failed UI build costs the mini app its UI UPDATE, never the mini app. A backend that fails to
// bundle removes the mini app (it cannot run); a UI that fails to build is usually a file an agent
// or a person is halfway through. Removing the mini app for that would take its backend and tools
// down mid-edit, so a re-stage keeps the artifact that last built, and a fresh stage ships the
// mini app without UI. Under `fatal` (release staging) a failure still stops the build.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MINI_APP_KIT_DIR_NAME } from '@localixai/api/mini-app-kit-layout'
import { miniAppUiEntry } from '@localixai/api/mini-app-ui-build'
import { MINI_APP_UI_ARTIFACT_DIR } from '@localixai/mini-app-sdk/ui-artifact'

import { miniAppsRoot } from './lib/bundled-roots.mjs'

const BUILDER_CLI = fileURLToPath(new URL('./build-mini-app-ui.mjs', import.meta.url))
/** The builder CLI's switch for an artifact without source maps (release staging). */
export const NO_SOURCE_MAPS_FLAG = '--no-source-maps'

/** The mini app kit staged beside `outMiniApps` — where the running app finds it too. */
export const miniAppKitDirOf = (outMiniApps) => join(dirname(outMiniApps), MINI_APP_KIT_DIR_NAME)

/**
 * Move a staged mini app's current artifact aside before its directory is replaced. The holding
 * directory sits beside the mini apps (a `.`-prefixed name discovery and the marker ignore).
 */
export function takeStagedUiArtifact(stagedMiniApp) {
  const artifact = join(stagedMiniApp, MINI_APP_UI_ARTIFACT_DIR)
  if (!existsSync(artifact)) return null
  const kept = join(mkdtempSync(join(dirname(stagedMiniApp), '.ui-previous-')), 'ui')
  renameSync(artifact, kept)
  return kept
}

/** Drop what {@link takeStagedUiArtifact} set aside. */
export function discardStagedUiArtifact(previous) {
  if (previous) rmSync(dirname(previous), { recursive: true, force: true })
}

/**
 * Build `<repoRoot>/mini-apps/<name>`'s UI into `<outMiniApps>/<name>/dist/ui`. Returns a skip
 * record when the build failed under `skip`, null otherwise. `previous` is what
 * {@link takeStagedUiArtifact} set aside: put back on failure, discarded otherwise.
 * `uiSourceMaps: false` builds without maps (release staging; development keeps them).
 */
export function stageMiniAppUi(
  name,
  {
    repoRoot,
    outMiniApps,
    log,
    onMiniAppError,
    previous = null,
    run = execFileSync,
    uiSourceMaps = true,
  },
) {
  const miniAppDir = join(miniAppsRoot(repoRoot), name)
  const artifact = join(outMiniApps, name, MINI_APP_UI_ARTIFACT_DIR)
  if (!miniAppUiEntry(miniAppDir) || !existsSync(join(outMiniApps, name))) {
    discardStagedUiArtifact(previous)
    return null
  }
  log(`building ${name} UI…`)
  try {
    // The builder retains the artifact it replaces. Restore it before building so a successful
    // re-stage carries its lazy chunks too; keep the backup for the failure path below.
    if (previous) cpSync(previous, artifact, { recursive: true })
    const args = [BUILDER_CLI, miniAppDir, artifact, miniAppKitDirOf(outMiniApps)]
    if (!uiSourceMaps) args.push(NO_SOURCE_MAPS_FLAG)
    run('bun', args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    discardStagedUiArtifact(previous)
    return null
  } catch (error) {
    if (onMiniAppError === 'fatal') {
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
        : `${name} UI failed to build — the mini app runs without its UI this run`,
    )
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return { name, reason }
  }
}
