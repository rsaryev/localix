import { randomUUID } from 'node:crypto'

import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import type { CapabilityKind } from './resolve'
import { announceSourceRemoved } from './removal-notice'
import { recordCoreChanges } from '../changes/core-entities'
import { SEMANTIC_GLOBAL_SCOPE } from '@localixai/mini-app-sdk/backend'

/**
 * The `capability_source` rows of ONE kind, read and written.
 *
 * This used to be three files — `plugins/repository.ts`, `agents/repository.ts`,
 * and one for agent providers — identical but for the table name, plus a shared
 * upsert that already carried a union of the three. One table means one repository,
 * parameterised by kind.
 *
 * What it does NOT hold is availability. A row says what is installed and how it is
 * configured; whether it may run is a rule in `capability_rule`, composed across global,
 * project and agent (see `availability.ts`).
 */
export interface CapabilitySourceRecord {
  id: string
  userId: string
  /** '' = sessions without a project; otherwise the exact project id. */
  projectId: string
  name: string
  /** The kind's own settings. Opaque here; each feature knows its own shape. */
  config: Record<string, unknown>
  /** 'local', a git URL, or `imported:<tool>`. */
  source: string
  createdAt: string
  updatedAt: string
}

export interface CapabilitySourcePatch {
  config?: Record<string, unknown>
  source?: string
}

export interface CapabilitySourceRepository {
  /**
   * Everything visible from here: the project's own rows PLUS the no-project ones.
   *
   * It used to be one exact scope, so opening a project hid every artifact you had installed
   * for yourself. Where a row lives still decides who it travels with — a project's rows ship
   * with the project — but it no longer decides whether you can see your own.
   *
   * A project row shadows a no-project row of the same name, which is the same precedence
   * filesystem discovery applies.
   */
  listForScope(userId: string, projectId: string): Promise<CapabilitySourceRecord[]>
  get(userId: string, projectId: string, name: string): Promise<CapabilitySourceRecord | null>
  /** Upsert on the natural key: patches the named fields or inserts a fresh row. */
  upsert(
    userId: string,
    projectId: string,
    name: string,
    patch: CapabilitySourcePatch,
  ): Promise<CapabilitySourceRecord>
  /**
   * Merge independent config fields in ONE statement.
   *
   * Not read-modify-write: two settings screens saving different fields of the same row
   * would each read the whole blob and write it back, and the later write would silently
   * drop the earlier one's field.
   */
  patchConfig(
    userId: string,
    projectId: string,
    name: string,
    values: Record<string, unknown>,
  ): Promise<CapabilitySourceRecord>
  remove(userId: string, projectId: string, name: string): Promise<void>
  /**
   * Every scope ('' = no project) holding a row of this name. Optional because only the
   * lifecycle's "removed from the last place it was installed" asks it.
   */
  scopesOf?(userId: string, name: string): Promise<string[]>
  /** Every row of the user, in every scope. Optional: only the boot-time config repair reads it. */
  listAll?(userId: string): Promise<CapabilitySourceRecord[]>
}

function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    // A hand-edited row must not take the whole list down with it.
    return {}
  }
}

export function createCapabilitySourceRepository(
  db: Kysely<AppDatabase>,
  kind: CapabilityKind,
  now: () => string = () => new Date().toISOString(),
): CapabilitySourceRepository {
  const mapRow = (row: {
    id: string
    user_id: string
    project_id: string
    name: string
    config: string
    source: string
    created_at: string
    updated_at: string
  }): CapabilitySourceRecord => ({
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    name: row.name,
    config: parseConfig(row.config),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  const ofKind = () => db.selectFrom('capability_source').selectAll().where('kind', '=', kind)

  /**
   * A settings write, and for a mini app its `mini-app` notice in the same transaction (C1): the
   * mini apps feature owns them, and every surface showing one re-reads it on that notice.
   */
  const announced = async (
    projectId: string,
    name: string,
    write: (trx: Kysely<AppDatabase>) => Promise<unknown>,
  ): Promise<void> => {
    if (kind !== 'mini-app') {
      await write(db)
      return
    }
    const run = async (trx: Kysely<AppDatabase>) => {
      await write(trx)
      await recordCoreChanges(trx, {
        entity: 'mini-app',
        op: 'upserted',
        ref: { id: name, scope: projectId || SEMANTIC_GLOBAL_SCOPE },
      })
    }
    await (db.isTransaction ? run(db) : db.transaction().execute(run))
  }

  const repo: CapabilitySourceRepository = {
    async listForScope(userId, projectId) {
      const scopes = projectId ? [projectId, ''] : ['']
      const rows = await ofKind()
        .where('user_id', '=', userId)
        .where('project_id', 'in', scopes)
        .orderBy('name', 'asc')
        .execute()
      // Project first on a name collision — the same precedence the filesystem scan uses.
      const byName = new Map<string, CapabilitySourceRecord>()
      for (const row of rows.map(mapRow)) {
        const held = byName.get(row.name)
        if (!held || (held.projectId === '' && row.projectId !== '')) byName.set(row.name, row)
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    },

    async get(userId, projectId, name) {
      const row = await ofKind()
        .where('user_id', '=', userId)
        .where('project_id', '=', projectId)
        .where('name', '=', name)
        .executeTakeFirst()
      return row ? mapRow(row) : null
    },

    async upsert(userId, projectId, name, patch) {
      const timestamp = now()
      const config = patch.config ? JSON.stringify(patch.config) : undefined
      // Atomic on the natural key — no check-then-write window. On conflict the id and
      // created_at are kept; only the patched fields move.
      await announced(projectId, name, (trx) =>
        trx
          .insertInto('capability_source')
          .values({
            id: randomUUID(),
            user_id: userId,
            kind,
            project_id: projectId,
            name,
            config: config ?? '{}',
            source: patch.source ?? 'local',
            created_at: timestamp,
            updated_at: timestamp,
          })
          .onConflict((oc) =>
            oc.columns(['user_id', 'kind', 'project_id', 'name']).doUpdateSet({
              ...(config !== undefined ? { config } : {}),
              ...(patch.source !== undefined ? { source: patch.source } : {}),
              updated_at: timestamp,
            }),
          )
          .execute(),
      )
      return (await repo.get(userId, projectId, name))!
    },

    async patchConfig(userId, projectId, name, values) {
      const timestamp = now()
      const serialized = JSON.stringify(values)
      await announced(projectId, name, (trx) =>
        trx
          .insertInto('capability_source')
          .values({
            id: randomUUID(),
            user_id: userId,
            kind,
            project_id: projectId,
            name,
            config: serialized,
            source: 'local',
            created_at: timestamp,
            updated_at: timestamp,
          })
          .onConflict((oc) =>
            oc.columns(['user_id', 'kind', 'project_id', 'name']).doUpdateSet({
              // `json_patch` merges server-side. The CASE repairs an invalid blob in place
              // rather than propagating a parse error out of a settings save.
              config: sql<string>`json_patch(
              CASE WHEN json_valid(config) THEN config ELSE '{}' END,
              ${serialized}
            )`,
              updated_at: timestamp,
            }),
          )
          .execute(),
      )
      return (await repo.get(userId, projectId, name))!
    },

    async scopesOf(userId, name) {
      const rows = await ofKind().where('user_id', '=', userId).where('name', '=', name).execute()
      return rows.map((row) => row.project_id)
    },

    async listAll(userId) {
      const rows = await ofKind().where('user_id', '=', userId).execute()
      return rows.map(mapRow)
    },

    async remove(userId, projectId, name) {
      const remove = async (trx: Kysely<AppDatabase>) => {
        const rows = await trx
          .deleteFrom('capability_source')
          .where('kind', '=', kind)
          .where('user_id', '=', userId)
          .where('project_id', '=', projectId)
          .where('name', '=', name)
          .returning(['id', 'name', 'project_id'])
          .execute()
        // An agent's removal is announced by the agents service, which knows its handle.
        if (kind === 'plugin' || kind === 'mcp')
          for (const row of rows) await announceSourceRemoved(trx, kind, row)
      }
      await (db.isTransaction ? remove(db) : db.transaction().execute(remove))
    },
  }
  return repo
}

/**
 * A stored `config` narrowed to the scalars a settings FORM can produce.
 *
 * The table's `config` is opaque JSON because MCP keeps a command array and a header
 * object in there. A plugin's and a provider's declared config is a flat scalar map, and
 * their resolvers say so in their types — so the narrowing happens here, once, instead of
 * as a cast at each of nine call sites. A non-scalar value is dropped rather than
 * coerced: a form never wrote it, so something else did, and guessing would be worse.
 */
export function scalarConfig(
  config: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!config) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(config)) {
    const kind = typeof value
    if (kind === 'string' || kind === 'number' || kind === 'boolean') {
      out[key] = value as string | number | boolean
    }
  }
  return out
}
