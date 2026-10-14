/**
 * The file paths a file-mutation call NAMES in its arguments, as written (unresolved).
 *
 * `edit` and `write` batch: an edit call carries `edits: [{ path, … }]` and a write call
 * `files: [{ path, content }]`, so a reader that looked only at a top-level `path` saw nothing
 * for a batch — the context engine lost its supersession keys and a streaming card had no title.
 * One reader for every shape keeps them agreeing:
 *
 * - top-level `path` / `file_path` (a single-file call, a historical item, a Claude Code
 *   `Edit`/`Write`/`MultiEdit` payload),
 * - `edits[].path` / `edits[].file_path`,
 * - `files[].path` / `files[].file_path`.
 *
 * Deduplicated in first-seen order; blank and non-string values are skipped. Pure and total —
 * it runs on partial streaming arguments and on whatever a hook or history row hands it.
 */
export function mutationInputPaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  const record = input as Record<string, unknown>
  const out: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && !out.includes(value)) out.push(value)
  }
  const pushEntry = (entry: unknown) => {
    if (!entry || typeof entry !== 'object') return
    const e = entry as Record<string, unknown>
    push(typeof e.path === 'string' ? e.path : e.file_path)
  }
  push(typeof record.path === 'string' ? record.path : record.file_path)
  for (const key of ['edits', 'files'] as const) {
    const list = record[key]
    if (Array.isArray(list)) for (const entry of list) pushEntry(entry)
  }
  return out
}
