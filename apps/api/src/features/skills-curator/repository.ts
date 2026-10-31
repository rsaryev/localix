import { randomUUID } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'

export type SkillScope = 'project' | 'global'

export interface SkillUsageRecord {
  userId: string
  projectId: string
  skillName: string
  scope: SkillScope
  getCount: number
  lastUsedAt: string | null
  pinned: boolean
  archivedAt: string | null
  /** Created in Localix (Store, `Skill` tool, or migrated from `.localix/skills`). */
  localixAuthored: boolean
  createdAt: string
  updatedAt: string
}

type Row = {
  user_id: string
  project_id: string
  skill_name: string
  scope: string
  get_count: number
  last_used_at: string | null
  pinned: number
  archived_at: string | null
  localix_authored: number
  created_at: string
  updated_at: string
}

function toRecord(row: Row): SkillUsageRecord {
  return {
    userId: row.user_id,
    projectId: row.project_id,
    skillName: row.skill_name,
    scope: row.scope === 'project' ? 'project' : 'global',
    getCount: row.get_count,
    lastUsedAt: row.last_used_at,
    pinned: row.pinned === 1,
    archivedAt: row.archived_at,
    localixAuthored: row.localix_authored === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface SkillUsageRepository {
  /** Increments get_count and bumps last_used_at; creates the row on first use. */
  recordUse(
    userId: string,
    projectId: string,
    skillName: string,
    scope: SkillScope,
    at?: string,
  ): Promise<void>
  list(userId: string, projectId: string): Promise<SkillUsageRecord[]>
  setPinned(
    userId: string,
    projectId: string,
    skillName: string,
    scope: SkillScope,
    pinned: boolean,
  ): Promise<SkillUsageRecord>
  setArchivedAt(
    userId: string,
    projectId: string,
    skillName: string,
    scope: SkillScope,
    archivedAt: string | null,
  ): Promise<SkillUsageRecord>
  /**
   * Records the skill as created in Localix, creating its row when it has none (`createdAt`
   * then dates the row, so an old skill is not young again). Idempotent.
   */
  markAuthored(
    userId: string,
    projectId: string,
    skillName: string,
    scope: SkillScope,
    createdAt?: string,
  ): Promise<void>
}

export function createSkillUsageRepository(db: Kysely<AppDatabase>): SkillUsageRepository {
  const now = () => new Date().toISOString()

  async function ensureRow(
    userId: string,
    projectId: string,
    skillName: string,
    scope: SkillScope,
  ): Promise<Row> {
    const existing = await db
      .selectFrom('skill_usage')
      .selectAll()
      .where('user_id', '=', userId)
      .where('project_id', '=', projectId)
      .where('skill_name', '=', skillName)
      .where('scope', '=', scope)
      .executeTakeFirst()
    if (existing) return existing as Row
    const ts = now()
    const row: Row = {
      user_id: userId,
      project_id: projectId,
      skill_name: skillName,
      scope,
      get_count: 0,
      last_used_at: null,
      pinned: 0,
      archived_at: null,
      localix_authored: 0,
      created_at: ts,
      updated_at: ts,
    }
    await db
      .insertInto('skill_usage')
      .values({ id: randomUUID(), ...row })
      .execute()
    return row
  }

  async function patch(
    userId: string,
    projectId: string,
    skillName: string,
    scope: SkillScope,
    values: Partial<Pick<Row, 'get_count' | 'last_used_at' | 'pinned' | 'archived_at'>>,
  ): Promise<SkillUsageRecord> {
    const base = await ensureRow(userId, projectId, skillName, scope)
    const updatedAt = now()
    await db
      .updateTable('skill_usage')
      .set({ ...values, updated_at: updatedAt })
      .where('user_id', '=', userId)
      .where('project_id', '=', projectId)
      .where('skill_name', '=', skillName)
      .where('scope', '=', scope)
      .execute()
    return toRecord({ ...base, ...values, updated_at: updatedAt })
  }

  return {
    /**
     * One atomic statement, not read-then-write.
     *
     * The obvious version — `ensureRow`, then `patch({ get_count: base.get_count + 1 })` — is the
     * lost-update shape this repo has been bitten by twice (`f77c92fc8`, `c47b137e1`). Measured
     * against the real database: 25 concurrent increments of exactly that shape landed a final
     * count of **2**, losing 24. Skills are far less exposed than tools (one `skill get` at a
     * time), but "less exposed" is not "safe", and the correct version is shorter than the wrong
     * one. SQLite does the arithmetic inside conflict resolution, so no interleaving is possible.
     *
     * The unique constraint this targets is the SCOPED one
     * (`skill_usage_user_project_skill_scope_unique`, four columns) — the same key `ensureRow`
     * looks up by, so the two cannot disagree about what "the same row" means.
     */
    async recordUse(userId, projectId, skillName, scope, at) {
      const ts = at ?? now()
      await sql`
        INSERT INTO skill_usage (
          id, user_id, project_id, skill_name, scope,
          get_count, last_used_at, pinned, archived_at, localix_authored, created_at, updated_at
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${projectId}, ${skillName}, ${scope},
          1, ${ts}, 0, NULL, 0, ${ts}, ${ts}
        )
        ON CONFLICT(user_id, project_id, skill_name, scope) DO UPDATE SET
          get_count = get_count + 1,
          last_used_at = ${ts},
          updated_at = ${ts}
      `.execute(db)
    },

    async list(userId, projectId) {
      const rows = await db
        .selectFrom('skill_usage')
        .selectAll()
        .where('user_id', '=', userId)
        .where('project_id', '=', projectId)
        .execute()
      return (rows as Row[]).map(toRecord)
    },

    async setPinned(userId, projectId, skillName, scope, pinned) {
      return patch(userId, projectId, skillName, scope, { pinned: pinned ? 1 : 0 })
    },

    async setArchivedAt(userId, projectId, skillName, scope, archivedAt) {
      return patch(userId, projectId, skillName, scope, { archived_at: archivedAt })
    },

    async markAuthored(userId, projectId, skillName, scope, createdAt) {
      const ts = now()
      const at = createdAt ?? ts
      await sql`
        INSERT INTO skill_usage (
          id, user_id, project_id, skill_name, scope,
          get_count, last_used_at, pinned, archived_at, localix_authored, created_at, updated_at
        )
        VALUES (
          ${randomUUID()}, ${userId}, ${projectId}, ${skillName}, ${scope},
          0, NULL, 0, NULL, 1, ${at}, ${ts}
        )
        ON CONFLICT(user_id, project_id, skill_name, scope) DO UPDATE SET
          localix_authored = 1,
          updated_at = ${ts}
      `.execute(db)
    },
  }
}
