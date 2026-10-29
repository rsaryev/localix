import { resolve } from 'node:path'
import { resolveToolCwd, shellQuote } from '../environment'

// Co-located file-tool helpers, re-exported so importers keep one stable surface.
export * from './file-io'
export * from './file-line-endings'
export * from './file-mtime'
export * from './file-path-lock'

// A unified diff stored on a tool result is for UI display only, but it still gets
// persisted and (defensively) could reach the model. A whole-file rewrite produces
// a diff as large as the file, so cap it: keep the head and tail, elide the middle.
export const MAX_DIFF_LINES = 240

export function capDiff(
  diff: string | undefined,
  maxLines: number = MAX_DIFF_LINES,
): string | undefined {
  if (!diff) return diff
  const lines = diff.split('\n')
  if (lines.length <= maxLines) return diff
  const head = Math.ceil(maxLines * 0.6)
  const tail = maxLines - head
  const elided = lines.length - head - tail
  return [
    ...lines.slice(0, head),
    `@@ … ${elided} more diff lines elided (display only) … @@`,
    ...lines.slice(lines.length - tail),
  ].join('\n')
}

export interface ResolvedFileTarget {
  cwd: string
  path: string
}

/**
 * Async hook invoked by write/edit AFTER a successful write, with the
 * absolute path(s) of the changed file(s). It notifies the language server, waits
 * for diagnostics, and returns a model-facing error block (or '' when clean) that
 * the tool appends to its own result. This replaces the standalone
 * `lsp_diagnostics` tool: diagnostics ride along with the edit instead of forcing
 * a separate model round-trip. Returns undefined/empty when no LSP is configured.
 */
export type DiagnosticsReporter = (filePaths: readonly string[]) => Promise<string | undefined>

/**
 * Append an LSP error block to a tool result's content, if any errors were found.
 * The block is wrapped in a single `<lsp_diagnostics>` envelope — the exact tag the
 * system prompt tells the model to watch for — so the model can reliably detect it
 * and the diagnostics are clearly delimited from the tool's own output. The inner
 * `<diagnostics file="…">` tags stay self-describing per file.
 */
export function appendDiagnostics(content: string, block: string | undefined): string {
  if (!block) return content
  return `${content}\n\n<lsp_diagnostics>\n${block}\n</lsp_diagnostics>`
}

/**
 * The person's editor, seen from a file tool: given a path and the text ON DISK at the moment
 * the tool read it (before any write), a self-delimited `<editor_buffer>` note when the file is
 * open with unsaved edits that disagree with that text, else ''. Must be asked BEFORE writing:
 * afterwards a clean tab (still showing the old text) and a dirty one look the same.
 */
export type EditorBufferProbe = (path: string, diskText: string, moment: 'read' | 'write') => string

/** Append an editor-buffer note (already delimited) to a tool result, if there is one. */
export function appendEditorBufferNote(content: string, note: string | undefined): string {
  return note ? `${content}\n\n${note}` : content
}

/**
 * Resolve a (possibly relative) file path to an absolute one: an absolute
 * `filePath` is returned as-is; otherwise it's resolved against `cwd` (itself
 * resolved against `defaultCwd` when relative), falling back to `~/.localix/workspace`
 * (see `resolveToolCwd`).
 * Shared by the read tool's parallel-scope + execution paths.
 *
 * The `.path` half of {@link resolveFileTarget} — the same resolution, for the many
 * callers that only want the file and not the directory it was resolved against.
 */
export function resolveTargetPath(filePath: string, cwd?: string, defaultCwd?: string): string {
  return resolveFileTarget(filePath, cwd, defaultCwd).path
}

/** Minimal env surface the not-found hint needs: a file reader + a shell exec. */
export interface SameNameHintEnv {
  readFile: (p: string) => Promise<unknown>
  exec: (
    command: string,
    opts?: { cwd?: string; signal?: AbortSignal },
  ) => Promise<{ stdout: string; exitCode: number }>
}

/**
 * Escape ripgrep/globset metacharacters so a basename is matched literally. Whitespace is
 * escaped too: ripgrep reads `--glob` with gitignore rules, which DROP unescaped trailing
 * spaces, so a file named `foo.ts ` could never be found.
 */
function escapeGlob(name: string): string {
  return name.replace(/[\\*?[\]{}!\s]/g, '\\$&')
}

/** Count trailing path segments `a` and `b` share (basename outward). */
function sharedSuffixLen(a: readonly string[], b: readonly string[]): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1
  return n
}

/**
 * Wrong-DIRECTORY recovery: the model guessed `utils/foo.ts` when the file is
 * `src/utils/foo.ts`. Enumerate same-basename files across the workspace with
 * `rg --files` (respects .gitignore, skips node_modules/.git/dist — no new dep),
 * bounded to 200 lines, and pick the candidate sharing the LONGEST trailing path
 * suffix with the requested path. Only suggest when that best is UNAMBIGUOUS (a
 * unique winner, or a lone candidate) so we never point the model at the wrong one
 * of several same-named files. Returns the absolute path, or '' when nothing clear.
 */
async function suffixMatchInWorkspace(
  env: SameNameHintEnv,
  base: string,
  targetPath: string,
  cwd: string,
): Promise<string> {
  let stdout: string
  try {
    // `base` is MODEL-supplied, and `env.exec` takes a shell string (local, ssh and docker
    // alike — there is no argv form). Splicing the glob between bare single quotes let a
    // name like `x'$(cmd)'` close the quote and run `cmd`, so the whole glob goes through
    // the one `shellQuote`. escapeGlob still runs first so ripgrep's globset reads the
    // basename literally; `**/x` matches `x` at any depth incl. root.
    const glob = shellQuote(`**/${escapeGlob(base)}`)
    // `-0` terminates each path with NUL: a newline split + trim mangled names with edge
    // whitespace or an embedded newline. `head -c` bounds the bytes on a huge tree
    // (`head -n` would count newlines, which NUL output no longer has, and BSD head has no
    // `-z`); a path cut by the cap lacks its NUL and is dropped below.
    const res = await env.exec(`rg --files -0 --glob ${glob} 2>/dev/null | head -c 65536`, {
      cwd,
    })
    if (res.exitCode !== 0 && !res.stdout) return ''
    stdout = res.stdout
  } catch {
    return ''
  }
  // Every complete entry ends with NUL, so the last split element is either '' or a
  // fragment truncated by the byte cap — never a whole path.
  const rels = stdout.split('\0').slice(0, -1).filter(Boolean).slice(0, 200)
  if (rels.length === 0) return ''
  const wantSegs = targetPath.split('/').filter(Boolean)
  let best: { rel: string; score: number } | null = null
  let tiedAtBest = false
  for (const rel of rels) {
    const score = sharedSuffixLen(wantSegs, rel.split('/').filter(Boolean))
    if (!best || score > best.score) {
      best = { rel, score }
      tiedAtBest = false
    } else if (score === best.score) {
      tiedAtBest = true
    }
  }
  if (!best) return ''
  // A single candidate is unambiguous; with several, only accept a lone top scorer.
  if (rels.length > 1 && tiedAtBest) return ''
  return `${cwd}/${best.rel}`
}

/**
 * On a not-found file access, point the model at the file it likely meant so it
 * doesn't burn a retry guessing. Two deterministic, best-effort cases:
 *  1. Same basename directly in `cwd` — the model prepended "/" to a bare workspace
 *     filename (asked for "/maze.html" when it lives in cwd). Fast path.
 *  2. Same basename elsewhere in the workspace — the model guessed the wrong
 *     DIRECTORY (`utils/foo.ts` → `src/utils/foo.ts`); recovered via a bounded,
 *     ignore-respecting `rg --files` search, suggested only when unambiguous.
 * Returns a "Did you mean: <path>" suffix, or '' when nothing clear. Tool-neutral —
 * shared by read and its internal visual-file adapter; any throw is swallowed into
 * the empty-hint case.
 */
export async function sameNameInCwdHint(
  env: SameNameHintEnv,
  targetPath: string,
  cwd: string | undefined,
): Promise<string> {
  const slash = targetPath.lastIndexOf('/')
  const base = slash >= 0 ? targetPath.slice(slash + 1) : targetPath
  if (!base) return ''
  const cleanCwd = cwd ? cwd.replace(/\/+$/, '') : ''

  // Case 1 — same basename directly in cwd.
  const candidate = cleanCwd ? `${cleanCwd}/${base}` : ''
  if (candidate && candidate !== targetPath) {
    try {
      await env.readFile(candidate)
      return `\nDid you mean: ${candidate}? (use that exact path)`
    } catch {
      // Not in cwd — fall through to the workspace search.
    }
  }

  // Case 2 — same basename in another directory of the workspace.
  if (!cleanCwd) return ''
  const match = await suffixMatchInWorkspace(env, base, targetPath, cleanCwd)
  return match && match !== targetPath ? `\nDid you mean: ${match}? (use that exact path)` : ''
}

/**
 * Resolve a file path AND the working directory it was resolved against. The cwd
 * half comes from {@link resolveToolCwd} — the single source of truth every
 * cwd-taking tool shares, so a relative `cwd` can never resolve differently for a
 * file tool than for bash/search (e.g. land outside the session's workspace for one
 * but not the other). `resolve()` returns an absolute `path` unchanged, so an
 * absolute file path still ignores the cwd.
 */
export function resolveFileTarget(
  path: string,
  cwd?: string,
  defaultCwd?: string,
): ResolvedFileTarget {
  const resolvedCwd = resolveToolCwd(cwd, defaultCwd)
  return {
    cwd: resolvedCwd,
    path: resolve(resolvedCwd, path),
  }
}

/**
 * Back `index` up to the nearest UTF-8 character START so a byte-cap slice never
 * splits a multi-byte char (which `toString('utf8')` would turn into U+FFFD).
 * Continuation bytes are `10xxxxxx` (`byte & 0xc0 === 0x80`).
 */
export function alignToCharBoundary(buffer: Buffer, index: number): number {
  let i = Math.min(index, buffer.byteLength)
  while (i > 0 && i < buffer.byteLength && (buffer[i] & 0xc0) === 0x80) i -= 1
  return i
}
