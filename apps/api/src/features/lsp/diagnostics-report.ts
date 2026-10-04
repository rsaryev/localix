import path from 'node:path'
import { isPathWithin } from '../../lib/path-containment'
import type { LspDiagnostic } from './lsp-client'

/**
 * Shared LSP-diagnostics formatting.
 *
 * Diagnostics are no longer surfaced through a dedicated `lsp_diagnostics` tool
 * (that forced a wasteful extra model round-trip after every edit). Instead the
 * formatted error block produced here is appended DIRECTLY to the result of the
 * tool that touched the file (`write` / `edit` / `apply_patch`), and a throttled
 * cross-turn `<system-reminder>` re-surfaces still-open errors. This keeps the
 * model aware of breakage it caused without ever calling a diagnostics tool.
 */

/** Only errors are appended inline — warnings/info/hints are noise on every edit. */
const SEVERITY_ERROR = 1
/** Cap per-file error lines so a single broken file can't blow up the context. */
const MAX_ERRORS_PER_FILE = 15
/** Cap how many OTHER files (besides the one just edited) we mention. */
const MAX_OTHER_FILES = 5
/**
 * Field separator for the (message, code) grouping key. NUL is the one byte that
 * cannot occur in a diagnostic message or code, so it can never collide with a
 * different (message, code) split.
 *
 * Written as the ESCAPE, never as a raw byte. A literal NUL in the source makes the
 * whole file "binary" to ripgrep, which then SKIPS it -- silently excluding this
 * module from every grep-based audit of the repo. It also renders as a space, so a
 * reader cannot even see the separator.
 */
const KEY_SEP = '\u0000'

export interface DiagnosticsReport {
  /** Model-facing text block to append to a tool result, or '' when clean. */
  block: string
  /** Error count in the file that was just edited. */
  fileErrorCount: number
  /** Error count across all other files with open errors. */
  otherErrorCount: number
}

function errorsOf(diags: LspDiagnostic[] | undefined): LspDiagnostic[] {
  if (!diags) return []
  return diags.filter((d) => (d.severity ?? SEVERITY_ERROR) === SEVERITY_ERROR)
}

/** One-line rendering: `[positions] message (code)` — positions of every duplicate. */
function prettyErrorGroup(positions: string[], d: LspDiagnostic): string {
  const code = d.code !== undefined && d.code !== '' ? ` (${d.code})` : ''
  // Collapse internal newlines so one diagnostic stays on one line.
  const message = d.message.replace(/\s*\n\s*/g, ' ').trim()
  const shown = positions.slice(0, 3).join(', ')
  const more = positions.length > 3 ? ` (+${positions.length - 3} more)` : ''
  return `  [${shown}${more}] ${message}${code}`
}

/** Render the `<diagnostics file="…">` block for a single file's errors, or '' if none. */
function renderFileBlock(filePath: string, projectRoot: string, errors: LspDiagnostic[]): string {
  if (errors.length === 0) return ''
  const rel = relativize(filePath, projectRoot)
  // Collapse IDENTICAL errors (same message + code, different positions) into one
  // line — a broken export/rename routinely spews the same diagnostic 10+ times.
  const groups = new Map<string, { positions: string[]; sample: LspDiagnostic }>()
  for (const d of errors) {
    const key = `${d.message}${KEY_SEP}${d.code ?? ''}`
    const pos = `${d.range.start.line + 1}:${d.range.start.character + 1}`
    const g = groups.get(key)
    if (g) g.positions.push(pos)
    else groups.set(key, { positions: [pos], sample: d })
  }
  const grouped = [...groups.values()]
  const shown = grouped.slice(0, MAX_ERRORS_PER_FILE)
  const moreGroups = grouped.length - shown.length
  const hiddenErrors = grouped
    .slice(MAX_ERRORS_PER_FILE)
    .reduce((n, g) => n + g.positions.length, 0)
  const lines = shown.map((g) => prettyErrorGroup(g.positions, g.sample))
  if (moreGroups > 0)
    lines.push(
      `  … and ${hiddenErrors} more error${hiddenErrors === 1 ? '' : 's'} (${moreGroups} distinct)`,
    )
  return `<diagnostics file="${rel}">\n${lines.join('\n')}\n</diagnostics>`
}

/**
 * Render a diagnostic's path relative to the project root, or absolute when the file
 * lives outside it. "Inside the root?" is asked through the shared owner
 * ({@link isPathWithin}) rather than re-derived here -- this module used to hand-roll
 * a sixth copy of that rule, and got it subtly wrong: a bare `rel.startsWith('..')`
 * also rejects a legitimate basename that merely BEGINS with two dots (`..foo`).
 */
function relativize(filePath: string, projectRoot: string): string {
  if (!projectRoot) return filePath
  if (!isPathWithin(projectRoot, filePath)) return filePath
  return path.relative(projectRoot, filePath) || filePath
}

/**
 * Build the inline diagnostics block to append to a file-mutating tool result.
 *
 * `editedFiles` are the paths the tool just changed (errors in these are always
 * shown first and in full). `allDiagnostics` is the manager's whole-project
 * snapshot; errors in OTHER files are summarized so cross-file breakage (e.g. a
 * renamed export) is still surfaced, but capped to avoid context blowup.
 */
export function buildInlineDiagnostics(
  editedFiles: readonly string[],
  allDiagnostics: Record<string, LspDiagnostic[]>,
  projectRoot: string,
): DiagnosticsReport {
  const editedSet = new Set(editedFiles)

  const editedBlocks: string[] = []
  let fileErrorCount = 0
  for (const file of editedFiles) {
    const errors = errorsOf(allDiagnostics[file])
    fileErrorCount += errors.length
    const block = renderFileBlock(file, projectRoot, errors)
    if (block) editedBlocks.push(block)
  }

  const otherBlocks: string[] = []
  let otherErrorCount = 0
  let otherFilesShown = 0
  let otherFilesWithErrors = 0
  for (const [file, diags] of Object.entries(allDiagnostics)) {
    if (editedSet.has(file)) continue
    const errors = errorsOf(diags)
    if (errors.length === 0) continue
    otherErrorCount += errors.length
    otherFilesWithErrors++
    if (otherFilesShown < MAX_OTHER_FILES) {
      otherBlocks.push(renderFileBlock(file, projectRoot, errors))
      otherFilesShown++
    }
  }

  if (editedBlocks.length === 0 && otherBlocks.length === 0) {
    return { block: '', fileErrorCount, otherErrorCount }
  }

  const parts: string[] = []
  if (editedBlocks.length > 0) {
    parts.push('LSP errors in the file you just changed — fix them before continuing:')
    parts.push(editedBlocks.join('\n'))
  }
  if (otherBlocks.length > 0) {
    const hiddenFiles = otherFilesWithErrors - otherFilesShown
    parts.push('LSP errors in other files (may be caused by this change):')
    parts.push(otherBlocks.join('\n'))
    if (hiddenFiles > 0)
      parts.push(`… and ${hiddenFiles} more file${hiddenFiles === 1 ? '' : 's'} with errors.`)
  }

  return { block: parts.join('\n'), fileErrorCount, otherErrorCount }
}

/** A file with open errors, for the throttled cross-turn reminder. */
export interface OpenErrorFile {
  file: string
  count: number
}

/**
 * Summarize the whole-project error state for the throttled cross-turn reminder.
 * Returns one entry per file that has open errors, sorted by error count desc.
 */
export function summarizeOpenErrors(
  allDiagnostics: Record<string, LspDiagnostic[]>,
  projectRoot: string,
): OpenErrorFile[] {
  const files: OpenErrorFile[] = []
  for (const [file, diags] of Object.entries(allDiagnostics)) {
    const errors = errorsOf(diags)
    if (errors.length === 0) continue
    files.push({ file: relativize(file, projectRoot), count: errors.length })
  }
  files.sort((a, b) => b.count - a.count)
  return files
}
