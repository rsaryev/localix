/**
 * Durable storage for comments. Every read and write is OWNER-scoped: a comment is addressed by
 * its id and the caller's user id together, so an id from someone else's scope answers as if it
 * did not exist rather than as "not yours".
 */
import { randomUUID } from 'node:crypto'
import type { Kysely, Selectable } from 'kysely'

import type { AppDatabase, CommentsTable } from '../../db/types'
import type { CommentRecord, CommentStatus } from './contracts'

function toRecord(row: Selectable<CommentsTable>): CommentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope,
    anchor: JSON.parse(row.anchor_json) as Record<string, unknown>,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CommentRepository {
  /** A scope's comments, oldest first — the order they were written in. */
  list(userId: string, scope: string): Promise<CommentRecord[]>
  create(input: {
    userId: string
    scope: string
    anchor: Record<string, unknown>
    body: string
  }): Promise<CommentRecord>
  /** Null when no such comment is the caller's. */
  update(
    userId: string,
    id: string,
    patch: { body?: string; status?: CommentStatus },
  ): Promise<CommentRecord | null>
  /** False when no such comment is the caller's. */
  remove(userId: string, id: string): Promise<boolean>
  /**
   * Take a scope's OPEN comments for delivery: mark them `sent` and return them, in one
   * statement, so two reviews racing each other cannot both send the same comment.
   */
  takeOpen(userId: string, scope: string): Promise<CommentRecord[]>
}

export function createCommentRepository(
  db: Kysely<AppDatabase>,
  now: () => string = () => new Date().toISOString(),
): CommentRepository {
  return {
    async list(userId, scope) {
      const rows = await db
        .selectFrom('comments')
        .selectAll()
        .where('user_id', '=', userId)
        .where('scope', '=', scope)
        .orderBy('created_at')
        .orderBy('id')
        .execute()
      return rows.map(toRecord)
    },

    async create(input) {
      const at = now()
      const row = await db
        .insertInto('comments')
        .values({
          id: randomUUID(),
          user_id: input.userId,
          scope: input.scope,
          anchor_json: JSON.stringify(input.anchor),
          body: input.body,
          status: 'open',
          created_at: at,
          updated_at: at,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
      return toRecord(row)
    },

    async update(userId, id, patch) {
      const row = await db
        .updateTable('comments')
        .set({
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updated_at: now(),
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirst()
      return row ? toRecord(row) : null
    },

    async remove(userId, id) {
      const rows = await db
        .deleteFrom('comments')
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .returning('id')
        .execute()
      return rows.length > 0
    },

    async takeOpen(userId, scope) {
      const rows = await db
        .updateTable('comments')
        .set({ status: 'sent', updated_at: now() })
        .where('user_id', '=', userId)
        .where('scope', '=', scope)
        .where('status', '=', 'open')
        .returningAll()
        .execute()
      return rows
        .map(toRecord)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    },
  }
}
