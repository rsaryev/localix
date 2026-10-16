import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { AppDatabase } from '../../db/types'

export interface ContributionRegistration<T> {
  id: string
  source: { id: string; kind: string; name: string }
  projectId: string
  key: string
  revision: number
  value: T
}

export const contributionReadErrorSchema = z.strictObject({
  id: z.string(),
  code: z.literal('invalid_contribution'),
})
export type ContributionReadError = z.infer<typeof contributionReadErrorSchema>

/**
 * The owning subsystem supplies its current schema at the read boundary. Stored JSON is not a
 * runtime contract: an older publication or a damaged row must not bypass current validation.
 * Registration only establishes identity and ownership; callers still evaluate trust and policy.
 */
export function createContributionReader<T>(
  db: Kysely<AppDatabase>,
  kind: string,
  schema: z.ZodType<T>,
) {
  const query = (userId: string, projectId: string) =>
    db
      .selectFrom('extension_contribution as contribution')
      .innerJoin('capability_source as source', (join) =>
        join
          .onRef('source.id', '=', 'contribution.source_id')
          .onRef('source.user_id', '=', 'contribution.user_id')
          .onRef('source.project_id', '=', 'contribution.project_id'),
      )
      .select([
        'contribution.id',
        'contribution.project_id',
        'contribution.contribution_key',
        'contribution.revision',
        'contribution.payload',
        'source.id as sourceId',
        'source.kind as sourceKind',
        'source.name as sourceName',
      ])
      .where('contribution.user_id', '=', userId)
      .where('contribution.project_id', '=', projectId)
      .where('contribution.kind', '=', kind)
      .where('contribution.active', '=', 1)

  type Row = Awaited<ReturnType<ReturnType<typeof query>['execute']>>[number]
  const decode = (
    row: Row,
  ): { registration: ContributionRegistration<T> } | { error: ContributionReadError } => {
    try {
      const value = schema.parse(JSON.parse(row.payload))
      return {
        registration: {
          id: row.id,
          source: { id: row.sourceId, kind: row.sourceKind, name: row.sourceName },
          projectId: row.project_id,
          key: row.contribution_key,
          revision: row.revision,
          value,
        },
      }
    } catch {
      // Diagnostics identify the registration, never echo potentially sensitive payloads.
      return { error: { id: row.id, code: 'invalid_contribution' } }
    }
  }

  return {
    /** Exact identity and scope only. Neither handles nor archived registrations are aliases. */
    async get(userId: string, projectId: string, id: string) {
      const row = await query(userId, projectId)
        .where('contribution.id', '=', id)
        .executeTakeFirst()
      return row ? decode(row) : null
    },
    /** One bad artifact remains diagnosable without hiding unrelated valid registrations. */
    async list(userId: string, projectId: string) {
      const rows = await query(userId, projectId)
        .orderBy('source.id')
        .orderBy('contribution.position')
        .execute()
      const registrations: ContributionRegistration<T>[] = []
      const errors: ContributionReadError[] = []
      for (const row of rows) {
        const decoded = decode(row)
        if ('registration' in decoded) registrations.push(decoded.registration)
        else errors.push(decoded.error)
      }
      return { registrations, errors }
    },
  }
}
