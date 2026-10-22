import { issue, type PluginIssue } from './issues'

/**
 * Component paths in a manifest are relative to the plugin root and start with `./`; the one
 * exception is `skills: "."`, the root itself. A path may not leave the root, and a backslash is
 * never a separator. Lexical checks only: whether a path exists, or a symlink leads out, is the
 * host's to see on disk.
 */
export function checkComponentPath(
  path: string,
  field: string,
  options: { allowRoot?: boolean } = {},
): PluginIssue | null {
  if (options.allowRoot && (path === '.' || path === './')) return null
  if (path.includes('\\'))
    return issue('error', field, `${field} path may not contain a backslash: ${path}`)
  if (!path.startsWith('./'))
    return issue('error', field, `${field} path must start with "./": ${path}`)
  if (path.split('/').includes('..'))
    return issue('error', field, `${field} path escapes plugin directory: ${path}`)
  return null
}

/** True for an `https://` address: an MCP bundle may be fetched instead of read from the plugin. */
export const isRemoteBundle = (path: string): boolean => /^https:\/\//i.test(path)
