import { mutationInputPaths } from '@localixai/agent/agents'

import { resolveFileTarget } from './file-utils'

/**
 * The batched shapes of `edit` and `write`, and the older single-file shapes they absorb.
 *
 * Both tools advertise ONE shape — `edit({ edits: [{ path, old_string, new_string }] })`,
 * `write({ files: [{ path, content }] })` — because one call per file was one model round-trip
 * per file. The single-file shapes are still recognised and lifted into the batch, so nothing
 * that already speaks them is refused:
 *
 * - Localix's previous `edit`/`write` (top-level `path`, `old_string`/`content`), which saved
 *   sessions, plugin callers and a model trained on them still send;
 * - Claude Code's `Edit` / `Write` (`file_path`) and `MultiEdit` (`file_path` + `edits` with
 *   no per-edit path), which a PreToolUse hook's `updatedInput` may hand back.
 *
 * Each function returns its input unchanged when it recognises nothing — the
 * `AgentTool.prepareArguments` contract — and is idempotent on the canonical shape.
 */

type Rec = Record<string, unknown>

const isRecord = (value: unknown): value is Rec =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const pathOf = (record: Rec): unknown => record.path ?? record.file_path

function withoutKeys(record: Rec, keys: readonly string[]): Rec {
  const out: Rec = {}
  for (const [key, value] of Object.entries(record)) if (!keys.includes(key)) out[key] = value
  return out
}

const SINGLE_EDIT_KEYS = ['path', 'file_path', 'old_string', 'new_string', 'replace_all']
const EDIT_ENTRY_KEYS = ['path', 'old_string', 'new_string', 'replace_all']
const WRITE_ENTRY_KEYS = ['path', 'content']

/**
 * A known entry key with a stray character glued to it, restored when the real key is absent.
 *
 * gpt-6-luna wrote `.new_string` (LOCALIX-158, LOCALIX-171) inside a 13-edit batch, and one
 * malformed key refused the whole batch. Only punctuation and whitespace at the ends are
 * stripped, and only into a key the entry is missing, so a real extra field still fails.
 */
function repairEntryKeys(entry: unknown, keys: readonly string[]): unknown {
  if (!isRecord(entry)) return entry
  let out: Rec | undefined
  for (const key of Object.keys(entry)) {
    if (keys.includes(key)) continue
    const bare = key.replace(/^[^a-z_]+|[^a-z_]+$/gi, '')
    // Against the repaired entry: two stray spellings of one key are ambiguous, so the second
    // stays put and validation refuses it rather than one value silently winning.
    if (!keys.includes(bare) || bare in (out ?? entry)) continue
    out ??= { ...entry }
    out[bare] = out[key]
    delete out[key]
  }
  return out ?? entry
}

/** The listed entries with their keys repaired, and whether any entry changed. */
function repairedList(listed: unknown[] | undefined, keys: readonly string[]) {
  const entries = listed?.map((entry) => repairEntryKeys(entry, keys))
  return { entries, changed: entries?.some((entry, i) => entry !== listed![i]) ?? false }
}

/** Lift any recognised edit shape into `{ edits: [{ path, old_string, new_string, replace_all? }] }`. */
export function prepareEditArguments(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const shared = pathOf(raw)
  const single =
    typeof raw.old_string === 'string'
      ? [
          {
            path: shared,
            old_string: raw.old_string,
            new_string: raw.new_string,
            ...(raw.replace_all !== undefined ? { replace_all: raw.replace_all } : {}),
          },
        ]
      : []
  const repaired = repairedList(Array.isArray(raw.edits) ? raw.edits : undefined, EDIT_ENTRY_KEYS)
  const listed = repaired.entries
  const needsLift =
    single.length > 0 ||
    shared !== undefined ||
    repaired.changed ||
    (listed?.some((edit) => isRecord(edit) && edit.path === undefined) ?? false)
  if (!needsLift) return raw
  const edits = [
    ...single,
    ...(listed ?? []).map((edit) => {
      if (!isRecord(edit)) return edit
      const own = pathOf(edit) ?? shared
      return { ...withoutKeys(edit, ['file_path']), ...(own !== undefined ? { path: own } : {}) }
    }),
  ]
  return { ...withoutKeys(raw, SINGLE_EDIT_KEYS), edits }
}

/** Lift any recognised write shape into `{ files: [{ path, content }] }`. */
export function prepareWriteArguments(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const shared = pathOf(raw)
  const repaired = repairedList(Array.isArray(raw.files) ? raw.files : undefined, WRITE_ENTRY_KEYS)
  const listed = repaired.entries
  const single =
    shared !== undefined && typeof raw.content === 'string'
      ? [{ path: shared, content: raw.content }]
      : []
  const needsLift =
    single.length > 0 ||
    repaired.changed ||
    (listed?.some((file) => isRecord(file) && file.path === undefined && 'file_path' in file) ??
      false)
  if (!needsLift) return raw
  const files = [
    ...single,
    ...(listed ?? []).map((file) =>
      isRecord(file) && file.path === undefined && 'file_path' in file
        ? { ...withoutKeys(file, ['file_path']), path: file.file_path }
        : file,
    ),
  ]
  return { ...withoutKeys(raw, ['path', 'file_path', 'content']), files }
}

/**
 * Every file a mutation call targets, resolved to absolute paths exactly as the tool will
 * resolve them. Runs on RAW input (`parallelScopePaths`, `classify` and the permission facts all
 * see a call before validation), so it reads every shape {@link mutationInputPaths} knows.
 */
export function mutationTargets(input: unknown, defaultCwd?: string): string[] {
  const cwd = isRecord(input) && typeof input.cwd === 'string' ? input.cwd : undefined
  const out: string[] = []
  for (const path of mutationInputPaths(input)) {
    const resolved = resolveFileTarget(path, cwd, defaultCwd).path
    if (!out.includes(resolved)) out.push(resolved)
  }
  return out
}
