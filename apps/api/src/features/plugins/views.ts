import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'

import { ApiError } from '../../lib/errors'
import { isPathBelow } from '../../lib/path-containment'
import type { PluginCatalog } from './catalog'
import { PLUGIN_VIEW_HTML_CAP_BYTES, type PluginViewSpec } from './contracts'

/**
 * Plugin UI VIEWS — the single UI-surface contract, as pure helpers over the
 * catalog so the service stays thin and the logic is testable without a DB.
 *
 * A view is manifest DATA (`views: [{ id, title, file, icon? }]`, a legacy
 * `panels` array promoted into the same shape at parse); its HTML is read from
 * the plugin dir only while the plugin is enabled, and the UI renders it inside
 * the sandboxed-iframe + CSP containment widget elements use, as a work-item tab.
 */

/** Flatten the views of every ENABLED plugin in scope. */
export function listViewsFromCatalog(catalog: PluginCatalog, projectId: string): PluginViewSpec[] {
  const views: PluginViewSpec[] = []
  for (const { plugin } of catalog.enabled) {
    if (!projectId && plugin.scope === 'project') continue
    for (const view of plugin.manifest.views ?? []) {
      views.push({
        pluginName: plugin.manifest.name,
        projectId: plugin.projectId,
        id: view.id,
        fullName: `${plugin.manifest.name}:${view.id}`,
        title: view.title,
        ...(view.icon ? { icon: view.icon } : {}),
        ...(view.agentDescription ? { agentDescription: view.agentDescription } : {}),
      })
    }
  }
  return views
}

/**
 * The ENABLED plugin whose UI HTML we are about to serve — or a 404 if it is
 * not enabled. The trust gate every HTML read goes through.
 */
export function requireEnabledPlugin(catalog: PluginCatalog, pluginName: string) {
  const entry = catalog.enabled.find(({ plugin }) => plugin.manifest.name === pluginName)
  if (!entry) throw new ApiError(404, 'plugin_not_enabled', `Plugin "${pluginName}" is not enabled`)
  return entry
}

/**
 * Read one HTML `file` from a plugin `dir`, path-confined to that directory
 * (a manifest pointing outside is rejected) and capped at
 * PLUGIN_VIEW_HTML_CAP_BYTES — the same bound the inline-widget renderer enforces.
 */
export async function readPluginHtmlFile(dir: string, file: string): Promise<{ html: string }> {
  const filePath = resolve(dir, file)
  if (!isPathBelow(dir, filePath)) {
    throw new ApiError(400, 'view_path_escape', 'UI file must live inside the plugin directory')
  }
  let html: string
  try {
    html = await fs.readFile(filePath, 'utf8')
  } catch {
    throw new ApiError(404, 'view_file_missing', `UI file not found: ${file}`)
  }
  if (!html.trim()) throw new ApiError(400, 'view_file_empty', 'UI file is empty')
  if (Buffer.byteLength(html) > PLUGIN_VIEW_HTML_CAP_BYTES) {
    throw new ApiError(
      400,
      'view_file_too_large',
      `UI HTML exceeds ${PLUGIN_VIEW_HTML_CAP_BYTES} bytes`,
    )
  }
  return { html }
}

/** Read one ENABLED plugin's view HTML (path-confined + size-capped). */
export async function readViewHtml(
  catalog: PluginCatalog,
  input: { pluginName: string; viewId: string },
): Promise<{ html: string }> {
  const entry = requireEnabledPlugin(catalog, input.pluginName)
  const view = (entry.plugin.manifest.views ?? []).find((v) => v.id === input.viewId)
  if (!view)
    throw new ApiError(
      404,
      'view_not_found',
      `Plugin "${input.pluginName}" declares no view "${input.viewId}"`,
    )
  return readPluginHtmlFile(entry.plugin.dir, view.file)
}
