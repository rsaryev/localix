import { createHash, randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import type { ExtensionContributionTable } from '../../db/extension-types'
import { ApiError } from '../../lib/errors'
import type { ContributionInput, ContributionKindRegistry } from './contribution-kinds'

export interface RegisteredContribution {
  id: string
  sourceId: string
  projectId: string
  kind: string
  key: string
  /** The owning subsystem validates this stored payload before use. */
  value: unknown
  revision: number
  archived: boolean
}
export interface ContributionSnapshot {
  revision: number
  contributions: RegisteredContribution[]
}

const decode = (row: ExtensionContributionTable): RegisteredContribution => ({
  id: row.id,
  sourceId: row.source_id,
  projectId: row.project_id,
  kind: row.kind,
  key: row.contribution_key,
  value: JSON.parse(row.payload),
  revision: row.revision,
  archived: row.active !== 1,
})

/**
 * Publishes one installation's complete native contribution set. Identity follows the active
 * registration, not a handle or a path. Removing and reintroducing a key issues a new identity.
 * Native payloads never receive source, revision, trust or archival fields.
 */
export function createContributionStore(
  db: Kysely<AppDatabase>,
  kinds: ContributionKindRegistry,
  now: () => string = () => new Date().toISOString(),
) {
  // Installation can compose this publication with its other writes in one outer transaction.
  const atomic = <T>(operation: (connection: Kysely<AppDatabase>) => Promise<T>): Promise<T> =>
    db.isTransaction ? operation(db) : db.transaction().execute(operation)
  const current = async (connection: Kysely<AppDatabase>, userId: string, sourceId: string) => {
    const source = await connection
      .selectFrom('capability_source')
      .select(['contribution_revision'])
      .where('id', '=', sourceId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!source) return null
    const rows = await connection
      .selectFrom('extension_contribution')
      .selectAll()
      .where('source_id', '=', sourceId)
      .where('user_id', '=', userId)
      .where('active', '=', 1)
      .orderBy('position')
      .execute()
    return { revision: source.contribution_revision, contributions: rows.map(decode) }
  }
  return {
    /** Consistent snapshot; an uninstalled source has no current contributions. */
    async getCurrent(userId: string, sourceId: string): Promise<ContributionSnapshot | null> {
      return atomic((transaction) => current(transaction, userId, sourceId))
    },

    /** Historical lookup never makes a removed contribution executable. */
    async getHistory(
      userId: string,
      contributionId: string,
    ): Promise<RegisteredContribution | null> {
      const row = await db
        .selectFrom('extension_contribution')
        .selectAll()
        .where('id', '=', contributionId)
        .where('user_id', '=', userId)
        .executeTakeFirst()
      return row ? decode(row) : null
    },

    async publish(
      userId: string,
      sourceId: string,
      expectedRevision: number,
      inputs: readonly ContributionInput[],
    ): Promise<ContributionSnapshot> {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        throw new ApiError(
          422,
          'invalid_revision',
          'Expected revision must be a non-negative integer',
        )
      }
      // Validate the whole set before any publication state can change.
      const normalized = kinds.normalize(inputs)
      const digest = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
      return atomic(async (transaction) => {
        const source = await transaction
          .selectFrom('capability_source')
          .selectAll()
          .where('id', '=', sourceId)
          .where('user_id', '=', userId)
          .executeTakeFirst()
        if (!source) throw new ApiError(404, 'source_not_found', 'Contribution source not found')
        // Retrying an already published set is a no-op, including a lost success response.
        if (source.contribution_digest === digest)
          return (await current(transaction, userId, sourceId))!
        const revision = source.contribution_revision + 1
        const claimed = await transaction
          .updateTable('capability_source')
          .set({ contribution_revision: revision, contribution_digest: digest })
          .where('id', '=', sourceId)
          .where('user_id', '=', userId)
          .where('contribution_revision', '=', expectedRevision)
          .executeTakeFirst()
        if (claimed.numUpdatedRows !== 1n) {
          throw new ApiError(
            409,
            'contribution_conflict',
            'Contribution publication changed; reload before retrying',
          )
        }
        const existing = await transaction
          .selectFrom('extension_contribution')
          .selectAll()
          .where('source_id', '=', sourceId)
          .where('active', '=', 1)
          .execute()
        const byKey = new Map(
          existing.map((row) => [JSON.stringify([row.kind, row.contribution_key]), row]),
        )
        const retained = new Set<string>()
        const timestamp = now()
        for (const [position, contribution] of normalized.entries()) {
          const previous = byKey.get(JSON.stringify([contribution.kind, contribution.key]))
          if (previous) {
            retained.add(previous.id)
            // The installation versions its ordered set. An individual registration versions
            // its payload: changing a sibling or its position must not invalidate its policy.
            const changed = previous.payload !== contribution.payload
            await transaction
              .updateTable('extension_contribution')
              .set({
                payload: contribution.payload,
                position,
                revision: changed ? revision : previous.revision,
                updated_at: changed ? timestamp : previous.updated_at,
              })
              .where('id', '=', previous.id)
              .execute()
          } else {
            await transaction
              .insertInto('extension_contribution')
              .values({
                id: `contribution:${randomUUID()}`,
                source_id: sourceId,
                user_id: userId,
                project_id: source.project_id,
                kind: contribution.kind,
                contribution_key: contribution.key,
                payload: contribution.payload,
                position,
                revision,
                active: 1,
                created_at: timestamp,
                updated_at: timestamp,
              })
              .execute()
          }
        }
        for (const row of existing) {
          if (!retained.has(row.id))
            await transaction
              .updateTable('extension_contribution')
              .set({ active: 0, revision, updated_at: timestamp })
              .where('id', '=', row.id)
              .execute()
        }
        return (await current(transaction, userId, sourceId))!
      })
    },
  }
}
