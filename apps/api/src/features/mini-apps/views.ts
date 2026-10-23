import { InvalidRequestError, NotFoundError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

import { isPathBelow } from '../../lib/path-containment'
import type { MiniAppCatalog } from './catalog'
import { MINI_APP_VIEW_HTML_CAP_BYTES, type MiniAppViewSpec } from './contracts-contributions'

/**
 * Mini app VIEWS — sandboxed HTML views, as pure helpers over the catalog so the service stays
 * thin and the logic is testable without a DB.
 *
 * A view is manifest DATA (`views: [{ id, title, file, icon? }]`); its HTML is read from the app's
 * folder only while the app is enabled, and the UI renders it inside the sandboxed iframe and CSP
 * containment widget elements use, as a work-item tab.
 */

/** Flatten the views of every ENABLED mini app in scope. */
export function listViewsFromCatalog(
  catalog: MiniAppCatalog,
  projectId: string,
): MiniAppViewSpec[] {
  const views: MiniAppViewSpec[] = []
  for (const { app } of catalog.enabled) {
    if (!projectId && app.scope === 'project') continue
    for (const view of app.views) {
      views.push({
        app: app.name,
        projectId: app.projectId,
        id: view.id,
        fullName: `${app.name}:${view.id}`,
        title: view.title,
        ...(view.icon ? { icon: view.icon } : {}),
        ...(view.agentDescription ? { agentDescription: view.agentDescription } : {}),
      })
    }
  }
  return views
}

/**
 * The ENABLED mini app whose UI HTML we are about to serve — or a 404 if it is not enabled. The
 * trust gate every HTML read goes through.
 */
export function requireEnabledMiniApp(catalog: MiniAppCatalog, name: string) {
  const entry = catalog.enabled.find(({ app }) => app.name === name)
  if (!entry) throw new NotFoundError('mini_app_not_enabled', `Mini app "${name}" is not enabled`)
  return entry
}

/**
 * Read one HTML `file` from a plugin `dir`, path-confined to that directory
 * (a manifest pointing outside is rejected) and capped at
 * MINI_APP_VIEW_HTML_CAP_BYTES — the same bound the inline-widget renderer enforces.
 */
export async function readMiniAppHtmlFile(dir: string, file: string): Promise<{ html: string }> {
  const filePath = resolve(dir, file)
  if (!isPathBelow(dir, filePath)) {
    throw new InvalidRequestError(
      'view_path_escape',
      'UI file must live inside the mini app folder',
    )
  }
  let html: string
  try {
    html = await fs.readFile(filePath, 'utf8')
  } catch {
    throw new NotFoundError('view_file_missing', `UI file not found: ${file}`)
  }
  if (!html.trim()) throw new InvalidRequestError('view_file_empty', 'UI file is empty')
  if (Buffer.byteLength(html) > MINI_APP_VIEW_HTML_CAP_BYTES) {
    throw new InvalidRequestError(
      'view_file_too_large',
      `UI HTML exceeds ${MINI_APP_VIEW_HTML_CAP_BYTES} bytes`,
    )
  }
  return { html }
}

/** Read one ENABLED mini app's view HTML (path-confined + size-capped). */
export async function readViewHtml(
  catalog: MiniAppCatalog,
  input: { app: string; viewId: string },
): Promise<{ html: string }> {
  const entry = requireEnabledMiniApp(catalog, input.app)
  const view = entry.app.views.find((v) => v.id === input.viewId)
  if (!view)
    throw new NotFoundError(
      'view_not_found',
      `Mini app "${input.app}" declares no view "${input.viewId}"`,
    )
  return readMiniAppHtmlFile(entry.app.dir, view.file)
}
