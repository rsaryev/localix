import { randomUUID } from 'node:crypto'

/**
 * What mods put in a conversation's prompt box and status line: drafts to fill (`$.prompt.fill`),
 * the dim suggestion Tab takes (`$.prompt.suggest`) and each mod's status text (`$.ui.status`) —
 * and the rows they appended (`$.session.append`), which the next prompt carries to the model.
 * Kept here by conversation; a client re-reads it on the `mods` poke, applies a fill once and says
 * so (`take`), as Claude Code's box applies one.
 */

export type FillMode = 'replace' | 'append' | 'insert'

export interface ComposerFill {
  id: string
  text: string
  mode: FillMode
}

export interface ComposerView {
  fills: ComposerFill[]
  suggestion: string | null
  /** Status text by plugin. */
  statuses: Record<string, string>
}

const MODES: readonly FillMode[] = ['replace', 'append', 'insert']
/** Fills a client has not taken yet; a mod filling in a loop keeps only the latest. */
const MAX_FILLS = 8

export function createModComposer(changed: () => void) {
  const sessions = new Map<string, ComposerView>()
  /** Rows a mod appended (`$.session.append`), for the model with the next prompt. */
  const notes = new Map<string, string[]>()
  const viewOf = (sessionId: string) => {
    let view = sessions.get(sessionId)
    if (!view) sessions.set(sessionId, (view = { fills: [], suggestion: null, statuses: {} }))
    return view
  }
  return {
    fill(sessionId: string, text: string, mode: unknown): ComposerFill {
      const fill = {
        id: randomUUID(),
        text,
        mode: MODES.includes(mode as FillMode) ? (mode as FillMode) : 'replace',
      }
      const view = viewOf(sessionId)
      view.fills = [...view.fills, fill].slice(-MAX_FILLS)
      changed()
      return fill
    },
    suggest(sessionId: string, text: string) {
      viewOf(sessionId).suggestion = text.trim() ? text : null
      changed()
    },
    status(sessionId: string, plugin: string, text: string | undefined) {
      const view = viewOf(sessionId)
      if (text?.trim()) view.statuses = { ...view.statuses, [plugin]: text }
      else {
        const { [plugin]: _gone, ...rest } = view.statuses
        view.statuses = rest
      }
      changed()
    },
    note(sessionId: string, text: string) {
      notes.set(sessionId, [...(notes.get(sessionId) ?? []), text])
    },
    takeNotes(sessionId: string): string[] {
      const taken = notes.get(sessionId) ?? []
      notes.delete(sessionId)
      return taken
    },
    view: (sessionId: string): ComposerView =>
      sessions.get(sessionId) ?? { fills: [], suggestion: null, statuses: {} },
    /** The client applied these fills, or took or dropped the suggestion. */
    take(sessionId: string, taken: { fills?: readonly string[]; suggestion?: boolean }) {
      const view = sessions.get(sessionId)
      if (!view) return
      const done = new Set(taken.fills ?? [])
      view.fills = view.fills.filter((fill) => !done.has(fill.id))
      if (taken.suggestion) view.suggestion = null
    },
    /** A mod that unloads leaves no status behind. */
    forget(plugin: string) {
      for (const view of sessions.values())
        if (plugin in view.statuses) {
          const { [plugin]: _gone, ...rest } = view.statuses
          view.statuses = rest
        }
    },
  }
}

export type ModComposer = ReturnType<typeof createModComposer>
