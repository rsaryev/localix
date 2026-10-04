// Content-type routing for the inspector file viewers — REGISTRY-backed. A
// subsystem/plugin that ships dedicated viewers registers its extensions here
// (`registerDedicatedViewerTypes`); the pure helpers below read the registry.
// No React / DOM / network — just string math over paths + content-types.
//
// Lives in `shared/lib` (not the inspector feature) because THREE layers route on
// it: the editor-grid registry (which viewer to mount), the inspector FileTab
// (read-only fallback), the chat fs.changed router (auto-open produced documents),
// and the window-level file-drop router (drag-to-open). Keeping it here is the one
// source of truth every layer consults without crossing a feature boundary. When
// no provider registered an extension, every helper honestly answers "plain
// editor" — the exact degradation an absent viewer contribution should produce.

import {
  fileExtension,
  type DedicatedViewerType,
  type FileViewerKind,
} from '@localixai/plugin-sdk/ui/file-types'
import { isPluginContributionEnabled } from '@/shared/contrib/pluginActivation'

export {
  CSV_CONTENT_TYPE,
  DOCX_CONTENT_TYPE,
  ODT_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  PPTX_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
  fileExtension,
} from '@localixai/plugin-sdk/ui/file-types'
export type { DedicatedViewerType, FileViewerKind } from '@localixai/plugin-sdk/ui/file-types'

// extension (no dot, lowercased) → registered format
type RegisteredViewerType = DedicatedViewerType & { pluginName?: string }
const registry = new Map<string, RegisteredViewerType[]>()

/**
 * Register dedicated-viewer formats (extension → content-type/viewer). Called by
 * the subsystem that owns the viewers; last write wins per
 * extension so a user plugin could override a bundled mapping.
 */
export function registerDedicatedViewerTypes(
  entries: Record<string, DedicatedViewerType>,
  pluginName?: string,
): void {
  for (const [ext, entry] of Object.entries(entries)) {
    const key = ext.toLowerCase()
    const variants = registry.get(key) ?? []
    if (
      variants.some(
        (candidate) =>
          candidate.pluginName === pluginName &&
          candidate.contentType === entry.contentType &&
          candidate.viewer === entry.viewer &&
          candidate.openExternally === entry.openExternally,
      )
    ) {
      continue
    }
    variants.push({ ...entry, pluginName })
    registry.set(key, variants)
  }
}

/** Drop every format `owner` registered (a plugin reload or unload). */
export function removeDedicatedViewerTypesOf(owner: string): void {
  for (const [key, variants] of registry) {
    const kept = variants.filter((entry) => entry.pluginName !== owner)
    if (kept.length) registry.set(key, kept)
    else registry.delete(key)
  }
}

function registeredType(path: string): RegisteredViewerType | undefined {
  const variants = registry.get(fileExtension(path))
  return variants?.findLast((entry) => isPluginContributionEnabled(entry.pluginName))
}

/** MIME content-type for a recognized viewer format, else `undefined` (opens in editor). */
export function contentTypeForPath(path: string): string | undefined {
  return registeredType(path)?.contentType
}

/** Which viewer should render this path — defaults to the code `editor`. */
export function fileViewerKind(path: string): FileViewerKind {
  return registeredType(path)?.viewer ?? 'editor'
}

/** True for binary office/PDF docs — read-only in-app, openable in a native app. */
export function isOpenExternallyType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  for (const variants of registry.values()) {
    const entry = variants.findLast((candidate) =>
      isPluginContributionEnabled(candidate.pluginName),
    )
    if (entry?.contentType === contentType) return entry.openExternally === true
  }
  return false
}

/**
 * True when this path gets a DEDICATED viewer (PDF / office document / spreadsheet)
 * rather than the plain code editor — i.e. it's a rendered artifact worth surfacing
 * on its own. Used by the auto-open-produced-document router (which viewer-format
 * files an agent wrote should pop a viewer tab) and the drag-to-open router (whether
 * a dropped file has an in-app viewer). A dot-less or unknown extension → false.
 */
export function hasDedicatedViewer(path: string): boolean {
  return registeredType(path) !== undefined
}

/**
 * Filter a set of changed/absolute file paths down to the ones that have a dedicated
 * viewer, de-duped and order-preserving. The fs-watch `fs.changed` event mixes
 * changed FILE paths with their parent DIRECTORY paths; directories carry no viewer
 * extension, so they fall out here — leaving just the document files an agent
 * produced that are worth auto-opening. Pure so the router's (stateful)
 * dedup/debounce is the only untested part.
 */
export function pickDocumentPaths(paths: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of paths) {
    if (seen.has(p) || !hasDedicatedViewer(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}
