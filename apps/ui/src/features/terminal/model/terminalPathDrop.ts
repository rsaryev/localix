import { OS_FAMILY } from '@localixai/kit/environment'
import {
  MESSAGE_BINDING_MIME,
  readMessageBindingDrag,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { shellQuote } from '@localixai/plugin-sdk/ui/utilities'

// A path is left VERBATIM when it has no shell-significant characters, so a clean
// path bracketed-pastes exactly as typed; anything with spaces or metacharacters
// is quoted so the shell sees ONE argument, the usual convention for dragging a
// file onto a terminal.
const SAFE_PATH = /^[A-Za-z0-9_@%+=:,./\\-]+$/

/**
 * Shell-quote a single path for `os` (defaults to the running platform). Windows shells have no
 * POSIX single quotes, so there the path is double-quoted with `"` doubled — the one quoting form
 * cmd.exe and PowerShell both read as a single argument; everywhere else it is the shared POSIX
 * quoter.
 */
export function quoteShellPath(p: string, os: typeof OS_FAMILY = OS_FAMILY): string {
  if (SAFE_PATH.test(p)) return p
  if (os === 'windows') return `"${p.replace(/"/g, '""')}"`
  return shellQuote(p)
}

/** Join dropped paths into a single space-separated, shell-quoted run with a
 *  trailing space (so the cursor lands ready for the next argument). */
export function formatDroppedPaths(paths: string[], os: typeof OS_FAMILY = OS_FAMILY): string {
  const quoted = paths.map((p) => quoteShellPath(p, os)).filter(Boolean)
  return quoted.length ? `${quoted.join(' ')} ` : ''
}

/** True when a drag carries something the terminal can turn into a path paste:
 *  an in-app file ref (file tree / editor tab) or native OS files. Read from the
 *  TYPE list, which is available during dragover (the DATA is protected). */
export function isPathDrop(types: readonly string[]): boolean {
  return types.includes(MESSAGE_BINDING_MIME) || types.includes('Files')
}

/**
 * Extract the shell-ready path text from a drop's DataTransfer, or '' when the
 * drop carries no usable path. Prefers native OS files (their absolute
 * filesystem paths), then our unified message-binding `file` payload. Non-file
 * bindings (sessions, tool calls) are ignored because they are not shell paths.
 */
export function pathTextFromDrop(dt: DataTransfer, os: typeof OS_FAMILY = OS_FAMILY): string {
  const filePaths = Array.from(dt.files ?? [])
    .map((f) => (f as File & { path?: string }).path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
  if (filePaths.length) return formatDroppedPaths(filePaths, os)

  const binding = readMessageBindingDrag(dt)
  const path = binding?.target.attributes?.path
  if (binding?.target.kind === 'file' && typeof path === 'string' && path)
    return formatDroppedPaths([path], os)
  return ''
}
