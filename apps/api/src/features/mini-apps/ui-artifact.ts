import { NotFoundError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  MINI_APP_UI_ARTIFACT_DIR,
  MINI_APP_UI_ARTIFACT_MANIFEST,
  isMiniAppUiArtifactManifest,
} from '@localixai/mini-app-sdk/ui-artifact'

import { isPathBelow } from '../../lib/path-containment'
import type { MiniAppCatalog } from './catalog'
import type { MiniAppUiDescriptor } from './contracts'
import type { DiscoveredMiniApp } from './discovery'

/**
 * A mini app's workbench UI, as the API advertises and serves it.
 *
 * The UI is a built artifact inside the mini app's folder (`dist/ui/`: written by staging for a
 * first-party miniApp, by the app's own build for a user miniApp), not source compiled into the
 * host. The API reads the artifact's own manifest into the miniApp record — the host imports the
 * entry by URL and replaces the miniApp when `revision` moves — and serves the files under
 * {@link miniAppUiUrl}. Nothing outside the artifact directory is ever served.
 *
 * Native UI runs in the host's page, so it follows the same trust rule as a native backend: a
 * first-party miniApp ships trusted, anything else needs the user's consent (its enable rule)
 * before a byte of it is served. The host imports only what its snapshot lists as enabled.
 */

export const MINI_APP_UI_ROUTE = '/rpc/mini-apps'

/** Where the host fetches `file` of `app`'s artifact. */
export function miniAppUiUrl(app: string, file: string): string {
  return `${MINI_APP_UI_ROUTE}/${encodeURIComponent(app)}/ui/${file}`
}

function artifactDir(miniApp: DiscoveredMiniApp): string {
  return join(miniApp.dir, MINI_APP_UI_ARTIFACT_DIR)
}

/**
 * The record's `ui` field: read FRESH from the artifact on every record build, because discovery
 * caches by manifest mtime and a rebuilt UI changes no `mini-app.json`. Undefined for a miniApp
 * without an artifact.
 */
export async function readMiniAppUiDescriptor(
  miniApp: DiscoveredMiniApp,
): Promise<MiniAppUiDescriptor | undefined> {
  let manifest: unknown
  try {
    manifest = JSON.parse(
      await fs.readFile(join(artifactDir(miniApp), MINI_APP_UI_ARTIFACT_MANIFEST), 'utf8'),
    )
  } catch {
    return undefined
  }
  if (!isMiniAppUiArtifactManifest(manifest)) return undefined
  const name = miniApp.name
  return {
    entry: miniAppUiUrl(name, manifest.entry),
    styles: manifest.styles.map((style) => miniAppUiUrl(name, style)),
    revision: manifest.revision,
  }
}

/**
 * The absolute path of one artifact file, or a 404. A first-party mini app's files are served
 * whatever its enablement — inert code the host imports only when its snapshot says enabled, and
 * a module URL carries no project scope to check enablement against. Any other mini app's files are
 * served only once the user consented to it.
 */
export function resolveMiniAppUiFile(catalog: MiniAppCatalog, name: string, file: string): string {
  const entry = catalog.all.find(({ app }) => app.name === name)
  if (!entry || (!entry.app.bundled && !entry.enabled)) {
    throw new NotFoundError('mini_app_ui_not_found', `Mini app "${name}" ships no UI`)
  }
  const root = artifactDir(entry.app)
  const path = resolve(root, file)
  if (!isPathBelow(root, path)) {
    throw new NotFoundError('mini_app_ui_not_found', 'UI file must live inside the UI artifact')
  }
  return path
}
