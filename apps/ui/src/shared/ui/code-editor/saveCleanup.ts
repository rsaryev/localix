// On-save cleanup preferences for the code editor (trim trailing whitespace, ensure a
// final newline). Two INDEPENDENT, DEFAULT-OFF transforms applied
// to a file's content at save time, just before it is persisted to disk.
//
// The source of truth is `agentSettings.editorSave` (synced from the backend via
// the settings store); the store mirrors it into the in-memory holder here so the
// lowest FSD layer (`shared/api/client.ts`'s save path) can read it without an
// upward import into `features/settings`. Pure module (no React/store import) —
// mirrors the sibling `autoSave.ts` pref module.

import { ensureFinalNewline, trimTrailingWhitespace } from './lineOps'

export interface SaveCleanupPrefs {
  /** Strip trailing spaces/tabs from every line on save. */
  trimTrailingWhitespace: boolean
  /** Guarantee the content ends with exactly one trailing newline on save. */
  ensureFinalNewline: boolean
}

const DEFAULT_PREFS: SaveCleanupPrefs = {
  trimTrailingWhitespace: false,
  ensureFinalNewline: false,
}

let prefs: SaveCleanupPrefs = { ...DEFAULT_PREFS }

/** Current on-save cleanup preferences. */
export function getSaveCleanupPrefs(): SaveCleanupPrefs {
  return prefs
}

/** Mirror the live `agentSettings.editorSave` values into this holder. */
export function setSaveCleanupPrefs(next: SaveCleanupPrefs): void {
  prefs = { ...next }
}

/**
 * Apply the ENABLED cleanup transforms to `content` in a fixed order (trim first,
 * then ensure a final newline). Pure. With both flags off (the default) the
 * content is returned unchanged, so save behavior never differs unless opted in.
 */
export function applySaveCleanup(content: string, p: SaveCleanupPrefs): string {
  let out = content
  if (p.trimTrailingWhitespace) out = trimTrailingWhitespace(out)
  if (p.ensureFinalNewline) out = ensureFinalNewline(out)
  return out
}

/**
 * Compose the on-save transforms in a fixed order: the LSP formatter's
 * output (format-on-save) FIRST, then the two pure
 * text cleanups on top of it. `formatted` is the formatter result, or `null`
 * when format-on-save is off / unavailable / errored / timed out — in which
 * case the raw `buffer` is used so a save is never blocked or lost. Pure; the
 * editor save path (`useFileEditor`) runs the formatter (a disk round-trip) and
 * feeds its text here to produce the final content it persists.
 */
export function composeOnSaveContent(
  buffer: string,
  formatted: string | null,
  p: SaveCleanupPrefs,
): string {
  return applySaveCleanup(formatted ?? buffer, p)
}
