import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type { PersistedMessage } from './contracts'
import { mapMessage } from './repository-mappers'

// Session-tree concerns: the leaf pointer accessors shared with the message writers
// (`createSessionLeafOps`) and the branch-navigation reads built on top of them.
// Split out of repository.ts; the leaf ops are created once per repository instance
// and passed to the message module so both sides move the same pointer.

/** The session-tree leaf pointer accessors, bound to one connection. */
export interface SessionLeafOps {
  currentLeaf: (sessionId: string, exec?: Kysely<AppDatabase>) => Promise<string | null>
  setLeaf: (sessionId: string, leafId: string | null, exec?: Kysely<AppDatabase>) => Promise<void>
  /**
   * The leaf a transcript read should walk up from — verified to exist, and repaired when it
   * does not. `null` means the session genuinely has no messages.
   */
  resolveActiveLeaf: (userId: string, sessionId: string) => Promise<string | null>
}

// Session-tree helpers (migration 20260607T000022): every inserted message
// links into the per-session tree via parent_id, and the session's leaf_id
// advances to the new entry. Linear inserts append at the current leaf; branch
// ops (regenerate/switchBranch) move the leaf first, so the next insert
// naturally attaches under the right parent.
// `exec` defaults to the pooled db but accepts a Transaction so multi-step
// writes (insert + leaf advance) commit atomically. Transaction<DB> extends
// Kysely<DB>, so the same type covers both.
export function createSessionLeafOps(db: Kysely<AppDatabase>): SessionLeafOps {
  const currentLeaf = async (
    sessionId: string,
    exec: Kysely<AppDatabase> = db,
  ): Promise<string | null> => {
    const row = await exec
      .selectFrom('agent_sessions')
      .select('leaf_id')
      .where('id', '=', sessionId)
      .executeTakeFirst()
    return row?.leaf_id ?? null
  }
  const setLeaf = async (
    sessionId: string,
    leafId: string | null,
    exec: Kysely<AppDatabase> = db,
  ): Promise<void> => {
    await exec
      .updateTable('agent_sessions')
      .set({ leaf_id: leafId })
      .where('id', '=', sessionId)
      .execute()
  }
  /**
   * Resolve the leaf for a read, repairing a pointer that cannot be walked.
   *
   * Read paths used to answer a missing or dangling pointer by returning the session's rows
   * in sequence order. That is not the conversation — abandoned regenerate branches are
   * interleaved into it as if the user had seen them — and because the answer looks plausible
   * it hid the broken pointer indefinitely. Migration 20260820T000000 normalized the existing
   * rows; this keeps the invariant true afterwards.
   *
   * One round trip, the same as the plain `currentLeaf` it replaces: the statement answers
   * "is there a pointer, does it point at a real row of this session, and what is the tail"
   * together, so the healthy path costs nothing extra and only a repair adds a write.
   *
   * The repair rule is the delete path's own: point at the highest-sequence remaining
   * message. It is loud, because reaching it means a writer left a pointer behind and today's
   * writers do not — the delete path fixes the leaf inside its own transaction.
   */
  const resolveActiveLeaf = async (userId: string, sessionId: string): Promise<string | null> => {
    const row = await sql<{ pointed: string | null; tail: string | null }>`
      SELECT
        (
          SELECT message.id
          FROM agent_messages AS message
          JOIN agent_sessions AS session ON session.leaf_id = message.id
          WHERE session.id = ${sessionId}
            AND message.session_id = ${sessionId}
            AND message.user_id = ${userId}
        ) AS pointed,
        (
          SELECT message.id
          FROM agent_messages AS message
          WHERE message.session_id = ${sessionId}
            AND message.user_id = ${userId}
          ORDER BY message.sequence DESC
          LIMIT 1
        ) AS tail
    `.execute(db)
    const { pointed, tail } = row.rows[0] ?? { pointed: null, tail: null }
    if (pointed) return pointed
    // No usable pointer and no messages: an empty session, which is not a defect.
    if (!tail) return null
    console.warn(
      `[chat-repository] session ${sessionId} had no usable tree leaf; repairing it to ${tail}`,
    )
    await setLeaf(sessionId, tail)
    return tail
  }

  return { currentLeaf, setLeaf, resolveActiveLeaf }
}

export function createTreeQueries(db: Kysely<AppDatabase>, leaf: SessionLeafOps) {
  const { currentLeaf, setLeaf } = leaf
  return {
    // ---- Session-tree branch ops --------------------------------------------

    /** The active leaf entry id (current branch tip), or null for an empty session. */
    getSessionLeaf(sessionId: string): Promise<string | null> {
      return currentLeaf(sessionId)
    },

    /** Move the active branch tip. Used by regenerate (rewind) and switchBranch. */
    setSessionLeaf(sessionId: string, leafId: string | null): Promise<void> {
      return setLeaf(sessionId, leafId)
    },

    /**
     * Every message in the session — ALL branches, sequence order — with its
     * tree parent. Feeds the branch-tree view; payloads come back deserialized
     * so callers can derive previews without re-querying.
     */
    async listMessageNodes(
      userId: string,
      sessionId: string,
    ): Promise<Array<{ message: PersistedMessage; parentId: string | null }>> {
      const rows = await db
        .selectFrom('agent_messages')
        .selectAll()
        .where('user_id', '=', userId)
        .where('session_id', '=', sessionId)
        .orderBy('sequence', 'asc')
        .execute()
      return rows.map((row) => ({ message: mapMessage(row), parentId: row.parent_id ?? null }))
    },

    /** Sibling message ids sharing a parent, ordered by sequence (branch alternatives). */
    async siblings(sessionId: string, messageId: string): Promise<string[]> {
      const target = await db
        .selectFrom('agent_messages')
        .select('parent_id')
        .where('session_id', '=', sessionId)
        .where('id', '=', messageId)
        .executeTakeFirst()
      if (!target) return []
      let q = db.selectFrom('agent_messages').select('id').where('session_id', '=', sessionId)
      q =
        target.parent_id === null
          ? q.where('parent_id', 'is', null)
          : q.where('parent_id', '=', target.parent_id)
      const rows = await q.orderBy('sequence', 'asc').execute()
      return rows.map((r) => r.id)
    },

    /**
     * Follow children from `fromId` down to a leaf, always taking the most recent
     * child at each step, and return that leaf id. Used to resolve a branch tip
     * when switching to a sibling subtree.
     */
    async descendToLeaf(sessionId: string, fromId: string): Promise<string> {
      let current = fromId
      const guard = new Set<string>()
      while (!guard.has(current)) {
        guard.add(current)
        const child = await db
          .selectFrom('agent_messages')
          .select('id')
          .where('session_id', '=', sessionId)
          .where('parent_id', '=', current)
          .orderBy('sequence', 'desc')
          .limit(1)
          .executeTakeFirst()
        if (!child) break
        current = child.id
      }
      return current
    },
  }
}
