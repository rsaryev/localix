import type { FileIconData, IconComponent } from '@localixai/mini-app-sdk/ui'
import { isMiniAppContributionEnabled } from './miniAppActivation'

interface OwnedContribution<T> {
  value: T
  miniAppName?: string
}

/**
 * Open presentation-icon registries. Resource nodes contribute ready React
 * components; exact file names contribute packaged SVG data so the heavy file
 * catalog and renderer remain interaction-loaded.
 */
const resourceIcons = new Map<string, OwnedContribution<IconComponent>>()
const fileIcons = new Map<string, OwnedContribution<FileIconData>>()

/** Register a batch of `resourceIcon` hint → icon entries. */
export function registerResourceRefIcons(
  entries: Record<string, IconComponent>,
  miniAppName?: string,
): void {
  for (const [key, icon] of Object.entries(entries)) {
    const existing = resourceIcons.get(key)
    if (existing?.value === icon && existing.miniAppName === miniAppName) continue
    if (existing) {
      console.warn(`[resource-ref-icons] duplicate icon key "${key}" — keeping the first owner`)
      continue
    }
    resourceIcons.set(key, { value: icon, miniAppName })
  }
}

/** Resolve a contributed `resourceIcon` hint → its icon. */
export function resourceRefIcon(key: string): IconComponent | undefined {
  const entry = resourceIcons.get(key)
  return entry && isMiniAppContributionEnabled(entry.miniAppName) ? entry.value : undefined
}

/** Register trusted, build-time SVG data for an exact file name. */
export function registerVscFileIcon(name: string, data: FileIconData, miniAppName?: string): void {
  const key = name.toLowerCase()
  const existing = fileIcons.get(key)
  if (existing?.value === data && existing.miniAppName === miniAppName) return
  if (existing) {
    console.warn(`[file-icons] duplicate file name "${key}" — keeping the first owner`)
    return
  }
  fileIcons.set(key, { value: data, miniAppName })
}

/** Resolve active contributed icon data without pulling in the SVG renderer. */
/** Drop every resource and file icon `owner` registered (a mini app reload or unload). */
export function removeIconsOf(owner: string): void {
  for (const map of [resourceIcons, fileIcons] as Map<string, OwnedContribution<unknown>>[]) {
    for (const [key, entry] of map) if (entry.miniAppName === owner) map.delete(key)
  }
}

export function contributedVscFileIcon(name: string): FileIconData | undefined {
  const entry = fileIcons.get(name.toLowerCase())
  return entry && isMiniAppContributionEnabled(entry.miniAppName) ? entry.value : undefined
}
