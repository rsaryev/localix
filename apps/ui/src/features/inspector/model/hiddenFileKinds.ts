import { useSyncExternalStore } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'

/**
 * The kinds of file (`docx`, `request.json`) whose "an app opens this" hint the person hid, across
 * launches: one hidden Word file hides it for every Word file, and a PDF still says it.
 */
const HIDDEN_FILE_KINDS = 'localix.file-opener-hint.hidden'

const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

// One set per stored string, so a snapshot read twice is the same value.
let held: { raw: string | null; kinds: ReadonlySet<string> } = { raw: null, kinds: new Set() }
function hiddenKinds(): ReadonlySet<string> {
  const raw = loadString(HIDDEN_FILE_KINDS)
  if (raw === held.raw) return held.kinds
  let kinds: string[] = []
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    if (Array.isArray(parsed)) kinds = parsed.filter((kind) => typeof kind === 'string')
  } catch {
    /* A value that does not read hides nothing. */
  }
  held = { raw, kinds: new Set(kinds) }
  return held.kinds
}

export function hideFileKind(kind: string): void {
  saveString(HIDDEN_FILE_KINDS, JSON.stringify([...hiddenKinds(), kind].sort()))
  for (const listener of listeners) listener()
}

/**
 * The hidden kinds, as a value: the built app's React Compiler keeps a render's call to a module
 * function on its arguments, so a hint read that way stayed on screen after Hide.
 */
export const useHiddenFileKinds = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, hiddenKinds, hiddenKinds)
