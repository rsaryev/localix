import { useSyncExternalStore } from 'react'
import type {
  FileTreeDecorationContribution,
  FileTreeDecorationIndex,
} from '@localixai/plugin-sdk/ui'

const EMPTY: FileTreeDecorationIndex = {
  decorationFor: () => undefined,
  directoryHasDecorations: () => false,
}
let contribution: FileTreeDecorationContribution | undefined
const listeners = new Set<() => void>()

export function registerFileTreeDecoration(input: FileTreeDecorationContribution): void {
  if (contribution) return
  contribution = input
  for (const listener of listeners) listener()
}

/** Release the decoration slot if `owner` holds it (a plugin reload or unload). */
export function removeFileTreeDecorationOf(owner: string): void {
  if (contribution?.pluginName !== owner) return
  contribution = undefined
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The id of the decoration currently filling the slot, if any. */
export function fileTreeDecorationProviderId(): string | null {
  return contribution?.id ?? null
}
const providerId = fileTreeDecorationProviderId

/**
 * The `key` a file-tree consumer mounts under: its session, and the provider its decorations came
 * from.
 *
 * The second half is a REMOUNT KEY, not a label. `useIndex` below is a hook chosen at runtime, and
 * plugin UI discovery imports the chunk that registers it well after first paint — so a tree that
 * mounted first would call zero hooks at that call site on one render and the provider's on the
 * next. React answers a changed hook order by unmounting the tree, which here means the whole
 * route: in a packaged build the user sees a crash screen and a journal row reading "Route failed"
 * with a minified React error and nothing naming the file tree. A runtime-chosen hook may only
 * change with a new component INSTANCE, and this is what gives it one.
 */
export function useFileTreeScopeKey(sessionId: string | null): string {
  const provider = useSyncExternalStore(subscribe, providerId, providerId)
  return `${sessionId ?? 'no-session'}:${provider ?? 'no-decorations'}`
}

/**
 * The decorations for one session.
 *
 * MUST be called from a component keyed on {@link useFileTreeScopeKey} — see there for why the
 * hook target may only change with a new component instance.
 */
export function useFileTreeDecorations(sessionId: string | null): FileTreeDecorationIndex {
  return contribution?.useIndex(sessionId) ?? EMPTY
}

/** Test seam: forget the registered provider. One bun process is shared across test files. */
export function __resetFileTreeDecorations(): void {
  contribution = undefined
  for (const listener of listeners) listener()
}
