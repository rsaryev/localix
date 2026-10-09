import type { LspServerDef } from './lsp-servers'

/** Match file paths using the same rules for built-in and plugin server definitions. */
export function matchingLspServers<T extends Pick<LspServerDef, 'extensions' | 'matchesFilename'>>(
  servers: readonly T[],
  filePath: string,
): T[] {
  const base = filePath.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : ''
  return servers.filter((s) => (ext && s.extensions.includes(ext)) || s.matchesFilename?.(base))
}
