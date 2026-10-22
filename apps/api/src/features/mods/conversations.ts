import type { ModScene } from './contracts'

/**
 * The conversations the mods have joined. A turn records where it ran and with which instances,
 * so an event between turns — a delivery reaching the conversation, a window attaching to it, a
 * mod's `$.prompt.compose` — goes to the mods its latest turn ran with. A compaction a mod asked
 * for (`$.session.compact`) waits here for the conversation's next turn, and the facts its system
 * prompt was last composed from wait for a `$.prompt.compose` query.
 */

/** Conversations remembered; the least recently run go first past it. */
const KEPT = 512

export interface ModConversation {
  scene: ModScene
  plugins: ReadonlySet<string>
  /** What the conversation's system prompt was last composed from (`run-prompt.ts`). */
  composed?: unknown
}

export function createModConversations(limit = KEPT) {
  const joined = new Map<string, ModConversation>()
  const compactions = new Set<string>()
  return {
    joined(scene: ModScene, plugins: ReadonlySet<string>): void {
      const id = scene.sessionId
      if (!id || plugins.size === 0) return
      const before = joined.get(id)
      joined.delete(id)
      joined.set(id, { scene, plugins, ...(before?.composed ? { composed: before.composed } : {}) })
      if (joined.size > limit) joined.delete(joined.keys().next().value!)
    },
    of: (sessionId: string | undefined): ModConversation | undefined =>
      sessionId ? joined.get(sessionId) : undefined,
    composed(sessionId: string | undefined, facts: unknown): void {
      const conversation = sessionId ? joined.get(sessionId) : undefined
      if (conversation) conversation.composed = facts
    },
    requestCompaction: (sessionId: string): void => void compactions.add(sessionId),
    /** True once for a conversation a mod asked to compact. */
    takeCompaction: (sessionId: string | undefined): boolean =>
      sessionId ? compactions.delete(sessionId) : false,
  }
}
