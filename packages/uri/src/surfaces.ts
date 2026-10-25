import { localixUiUri } from './grammar'

/** Canonical in-app destination for a file shown by the workbench inspector. */
export function fileUiUri(input: { path: string; line?: number }): string {
  const line = Number.isSafeInteger(input.line) && input.line! > 0 ? String(input.line) : undefined
  return localixUiUri('work-item', ['file'], { path: input.path, line })
}

/** Markdown affordance a tool can hand the model verbatim for its final response. */
export function fileOpenMarkdownLink(path: string, title?: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  const fileName = segments.length > 0 ? segments[segments.length - 1]! : path
  const label = (title?.trim() || fileName).replace(/[\\[\]]/g, '\\$&')
  return `[${label}](${fileUiUri({ path })})`
}

/** Canonical settings surface URI shared by backend search and frontend navigation. */
export function settingsUiUri(
  tab?: string,
  options: { anchor?: string; entryId?: string; scope?: string } = {},
): string {
  return localixUiUri(
    'settings',
    [
      tab ?? 'root',
      ...(options.anchor ? [options.anchor] : []),
      ...(options.entryId ? [options.entryId] : []),
    ],
    { scope: options.scope },
  )
}

/** Stable element id for one entity row inside a registry-like settings tab. */
export function settingsEntityAnchor(entity: string, id: string): string {
  return `${entity}-${id}`
}

/** Canonical exact-scope link to an entity row inside Settings. */
export function settingsEntityUiUri(tab: string, entity: string, id: string, scope = ''): string {
  return settingsUiUri(tab, {
    anchor: settingsEntityAnchor(entity, id),
    scope,
  })
}
