/**
 * One-way channel for "open this code block as a scratch file in the editor", mirroring
 * {@link terminalBus} (chat/code-block → shared ← chat feature). A code block in the
 * transcript calls `codeSnippet.open({ ext, code })`; the chat feature registers a handler
 * that writes the snippet to a per-session scratch file with that extension and opens it in
 * the editor, where extension-based routing takes over. Kept GENERIC (no language named here) and in
 * shared/lib so the shared-layer CodeBlock can emit without importing a feature or a mini app.
 */

import { useSyncExternalStore } from 'react'

/** A snippet to open: raw source + the file extension that drives editor routing. */
export interface CodeSnippet {
  /** The chat whose transcript holds the block: the scratch file is written to, and opened in,
   *  that chat's workspace — not the one on screen. */
  sessionId: string
  /** Bare file extension WITHOUT the dot (e.g. `sql`). */
  ext: string
  /** The code to write into the scratch file. */
  code: string
}

type Handler = (snippet: CodeSnippet) => void

let handler: Handler | null = null
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

export const codeSnippet = {
  /** The chat feature registers how to materialize + open a code snippet. */
  setHandler: (fn: Handler): (() => void) => {
    handler = fn
    emit()
    return () => {
      if (handler === fn) {
        handler = null
        emit()
      }
    }
  },

  /** Subscribe to availability changes (so a memoized code block re-renders when it flips). */
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /** True when a handler is mounted — the code block hides the button otherwise (no dead action). */
  isAvailable: (): boolean => {
    return handler !== null
  },

  /** Open the given snippet as a scratch editor tab (no-op if no handler is registered). */
  open: (snippet: CodeSnippet): void => {
    handler?.(snippet)
  },
}

/** Reactive `codeSnippet.isAvailable()` — flips a memoized code block's "Open" button on/off. */
export function useCodeSnippetAvailable(): boolean {
  return useSyncExternalStore(codeSnippet.subscribe, codeSnippet.isAvailable, () => false)
}

/**
 * Map a highlight LANGUAGE token to the scratch-file extension the "Open in editor" affordance
 * should use, or null when the language has no dedicated editor worth opening a scratch file
 * for. Generic + extensible: today only SQL dialects resolve (they route to the database
 * mini app's `.sql` editor with Run + autocomplete); other languages simply don't offer the
 * button, matching the prior behaviour. This is language detection (like the shell "Run"
 * regex), NOT a subsystem reference.
 */
export function snippetExtFor(language: string | undefined): string | null {
  if (!language) return null
  if (/^(sql|postgres|postgresql|mysql|sqlite|tsql|plsql|plpgsql)$/i.test(language)) return 'sql'
  return null
}
