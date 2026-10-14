import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'

/**
 * Remembered "Open with" choices — when several contributed editors match the
 * same file, the user's pick is persisted PER EXTENSION (the routing key every
 * contribution matches on) so the chooser appears once, not on every open.
 * Keyed by contribution id (stable across reloads); a remembered id whose
 * contribution disappeared (plugin removed) is simply ignored by the caller.
 */

const STORAGE_KEY = 'localix.fileEditorChoice'

/** Sentinel choice id: the built-in fallback (code editor / media viewer). */
export const BUILTIN_EDITOR_CHOICE = '__builtin__'

type ChoiceMap = Record<string, string>

/** Lowercased extension without the dot; `''` when none (dot-less names allowed). */
export function choiceKeyFor(pathOrName: string): string {
  const base = (pathOrName.split(/[\\/]/).pop() ?? '').toLowerCase()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : base
}

/** The remembered contribution id for a file's extension, or null. */
export function rememberedFileEditor(pathOrName: string, preferenceKey?: string): string | null {
  const map = loadJSON<ChoiceMap>(STORAGE_KEY)
  return map?.[preferenceKey ?? choiceKeyFor(pathOrName)] ?? null
}

/** Persist (or with `null` clear) the chooser pick for a file's extension. */
export function rememberFileEditor(
  pathOrName: string,
  contributionId: string | null,
  preferenceKey?: string,
): void {
  const map = loadJSON<ChoiceMap>(STORAGE_KEY) ?? {}
  const key = preferenceKey ?? choiceKeyFor(pathOrName)
  if (contributionId === null) delete map[key]
  else map[key] = contributionId
  saveJSON(STORAGE_KEY, map)
}
