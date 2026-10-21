import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import { nextRefSeq } from '../../db'
import { recordCoreChanges } from '../changes/core-entities'
import { projectRef } from './contracts'

/**
 * A project announces what a consumer of its scope cares about: it exists, moved folder, was
 * renamed, deleted or restored. A settings-only write is not announced — no consumer reads them
 * from the feed, and each would reload every project's plugin backends.
 */
const announce = (
  trx: Parameters<typeof recordCoreChanges>[0],
  userId: string,
  id: string,
  op: 'upserted' | 'deleted',
) => recordCoreChanges(trx, { entity: 'project', op, ref: { id, userId } })

export interface ProjectRecord {
  id: string
  /** Global sequence → the canonical `PRJ-<seq>` id. */
  seq?: number
  userId: string
  name: string
  workingDir: string
  settings: string | null
  createdAt: string
  updatedAt: string
  /**
   * Soft-deleted at this time; null = live.
   *
   * A project is never removed. Its sessions carry a NOT NULL `project_id`, so a hard delete
   * could only orphan them into the global capability scope — the conflation the default
   * project exists to end — or take them with it, and neither is what "delete this project"
   * means. Re-opening the same directory revives the row, and its sessions and its scope's
   * rules come back with it.
   */
  deletedAt: string | null
}

const mapProject = (row: {
  id: string
  seq: number
  user_id: string
  name: string
  working_dir: string
  settings: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}): ProjectRecord => ({
  id: row.id,
  seq: row.seq,
  userId: row.user_id,
  name: row.name,
  workingDir: row.working_dir,
  settings: row.settings,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
})

export function createProjectsRepository(db: Kysely<AppDatabase>) {
  return {
    /** LIVE projects. A soft-deleted one is gone as far as every ordinary caller is concerned. */
    async listProjects(userId: string): Promise<ProjectRecord[]> {
      const rows = await db
        .selectFrom('projects')
        .selectAll()
        .where('user_id', '=', userId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute()

      return rows.map(mapProject)
    },

    /**
     * Every project including the soft-deleted ones.
     *
     * The revival path, and the one a SESSION's project must be read through: a session in a
     * deleted project still has to resolve its cwd and its capability scope rather than fail,
     * because deletion hid the project — it did not end the conversations inside it.
     */
    async listAllProjects(userId: string): Promise<ProjectRecord[]> {
      const rows = await db
        .selectFrom('projects')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .execute()

      return rows.map(mapProject)
    },

    /** Reads a project whether or not it is soft-deleted — see `listAllProjects`. */
    async getProject(userId: string, id: string): Promise<ProjectRecord | null> {
      const row = await db
        .selectFrom('projects')
        .selectAll()
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()

      return row ? mapProject(row) : null
    },

    /**
     * Reserve the next globally unique `PRJ-<seq>` ref, which is also the project's
     * canonical id.
     */
    async allocateProjectRef(_userId: string): Promise<{ seq: number; id: string }> {
      const seq = await nextRefSeq(db, 'projects')
      return { seq, id: projectRef(seq) }
    },

    async insertProject(record: ProjectRecord): Promise<void> {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('projects')
          .values({
            id: record.id,
            seq: record.seq ?? 0,
            user_id: record.userId,
            name: record.name,
            working_dir: record.workingDir,
            settings: record.settings,
            created_at: record.createdAt,
            updated_at: record.updatedAt,
            deleted_at: record.deletedAt,
          })
          .execute()
        await announce(trx, record.userId, record.id, record.deletedAt ? 'deleted' : 'upserted')
      })
    },

    async updateProject(
      userId: string,
      id: string,
      patch: Partial<Omit<ProjectRecord, 'id' | 'userId' | 'createdAt'>>,
    ): Promise<void> {
      await db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable('projects')
          .set({
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.workingDir !== undefined ? { working_dir: patch.workingDir } : {}),
            ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
            ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
            ...(patch.deletedAt !== undefined ? { deleted_at: patch.deletedAt } : {}),
          })
          .where('user_id', '=', userId)
          .where('id', '=', id)
          .executeTakeFirst()
        const scoped =
          patch.name !== undefined ||
          patch.workingDir !== undefined ||
          patch.deletedAt !== undefined
        if (scoped && Number(result.numUpdatedRows) > 0)
          await announce(trx, userId, id, patch.deletedAt ? 'deleted' : 'upserted')
      })
    },

    /**
     * SOFT delete: hide the project, keep its row, its sessions and its capability scope.
     *
     * Idempotent, and it never touches an already-deleted row's timestamp — deleting twice is
     * one deletion, and the first one is when it happened.
     */
    async deleteProject(userId: string, id: string, at: string): Promise<void> {
      await db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable('projects')
          .set({ deleted_at: at })
          .where('user_id', '=', userId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
        if (Number(result.numUpdatedRows) > 0) await announce(trx, userId, id, 'deleted')
      })
    },

    /** Bring a soft-deleted project back, with everything that still points at it. */
    async restoreProject(userId: string, id: string): Promise<void> {
      await db.transaction().execute(async (trx) => {
        const result = await trx
          .updateTable('projects')
          .set({ deleted_at: null })
          .where('user_id', '=', userId)
          .where('id', '=', id)
          .executeTakeFirst()
        if (Number(result.numUpdatedRows) > 0) await announce(trx, userId, id, 'upserted')
      })
    },
  }
}
