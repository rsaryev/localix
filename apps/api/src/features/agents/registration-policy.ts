import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/domain-errors'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import { stableStringify } from '@localixai/agent'
import type { AppDatabase } from '../../db/types'
import { createContributionReader } from '../ext/contribution-reader'
import { capabilityRuleSchema } from '../capabilities/rule-schema'
import type { CapabilityStores } from '../capabilities/store-factory'
import { agentContributionSchema } from './contribution'

export const publishRegistrationPolicySchema = z.strictObject({
  expectedRegistrationRevision: z.number().int().nonnegative(),
  expectedPolicyRevision: z.number().int().nonnegative(),
  /** The complete native policy reviewed by the caller, not an implicit import grant. */
  rules: z.array(capabilityRuleSchema).max(500),
})
export type PublishRegistrationPolicy = z.infer<typeof publishRegistrationPolicySchema>

/** Policy and registration are separately versioned. Neither snapshot can approve a newer one. */
export function createRegistrationPolicyService(db: Kysely<AppDatabase>, stores: CapabilityStores) {
  const atomic = <T>(operation: (connection: Kysely<AppDatabase>) => Promise<T>): Promise<T> =>
    db.isTransaction ? operation(db) : db.transaction().execute(operation)
  const requireRegistration = async (
    connection: Kysely<AppDatabase>,
    userId: string,
    projectId: string,
    id: string,
  ) => {
    const result = await createContributionReader(connection, 'agent', agentContributionSchema).get(
      userId,
      projectId,
      id,
    )
    if (!result) throw new NotFoundError('agent_not_found', 'Registered agent not found')
    if ('error' in result)
      throw new UnprocessableError('invalid_contribution', 'The registered definition is invalid')
    return result.registration
  }
  const service = {
    /** Policy belongs to the owner and stable ID; this is not cross-project invocation. */
    async reviewIfRegistered(userId: string, id: string) {
      return atomic(async (connection) => {
        const row = await connection
          .selectFrom('extension_contribution')
          .select('project_id')
          .where('user_id', '=', userId)
          .where('id', '=', id)
          .where('kind', '=', 'agent')
          .where('active', '=', 1)
          .executeTakeFirst()
        if (!row) return null
        return createRegistrationPolicyService(connection, stores).review(
          userId,
          row.project_id,
          id,
        )
      })
    },
    async review(userId: string, projectId: string, id: string) {
      return atomic(async (connection) => {
        const registration = await requireRegistration(connection, userId, projectId, id)
        const policy = await stores.rules(connection).readSnapshot(userId, id)
        return {
          agentId: id,
          projectId: registration.projectId,
          sourceName: registration.source.name,
          registrationRevision: registration.revision,
          policyRevision: policy.revision,
          currentRules: policy.rules,
          proposedRules: registration.value.policyProposals,
        }
      })
    },
    async publish(userId: string, projectId: string, id: string, input: PublishRegistrationPolicy) {
      const reviewed = publishRegistrationPolicySchema.parse(input)
      return atomic(async (connection) => {
        const registration = await requireRegistration(connection, userId, projectId, id)
        if (registration.revision !== reviewed.expectedRegistrationRevision)
          throw new ConflictError(
            'contribution_conflict',
            'The registered agent changed; review it again',
          )
        const policies = stores.rules(connection)
        const current = await policies.readSnapshot(userId, id)
        const switches = current.rules.filter(
          (rule) =>
            rule.resource === '*' &&
            ['agent:', 'plugin:', 'mini-app:'].some((prefix) => rule.action.startsWith(prefix)),
        )
        const effectiveRules = [
          ...reviewed.rules.filter(
            (rule) =>
              !switches.some(
                (choice) => choice.action === rule.action && choice.resource === rule.resource,
              ),
          ),
          ...switches,
        ]
        const binding = await connection
          .selectFrom('capability_policy_binding')
          .selectAll()
          .where('user_id', '=', userId)
          .where('contribution_id', '=', id)
          .where('agent_id', '=', id)
          .executeTakeFirst()
        // A lost success response may be retried, but not after any subsequent policy write.
        if (
          binding?.contribution_revision === registration.revision &&
          binding.policy_revision === current.revision &&
          current.revision === reviewed.expectedPolicyRevision + 1 &&
          stableStringify(current.rules) === stableStringify(effectiveRules)
        ) {
          return {
            agentId: id,
            registrationRevision: registration.revision,
            policyRevision: current.revision,
          }
        }
        // The reviewed rules are what the agent MAY DO. Whether it — or the source it came
        // from — is switched on at all is a different statement, made by the user in Settings,
        // and it lives in the same list now that an agent's rules are its whole policy. A
        // publication that replaced the list wholesale silently switched the agent back off
        // the moment its policy was approved.
        const policyRevision = await policies.publish(
          userId,
          id,
          effectiveRules,
          reviewed.expectedPolicyRevision,
        )
        await connection
          .insertInto('capability_policy_binding')
          .values({
            user_id: userId,
            contribution_id: id,
            agent_id: id,
            contribution_revision: registration.revision,
            policy_revision: policyRevision,
          })
          .onConflict((conflict) =>
            conflict.columns(['user_id', 'contribution_id', 'agent_id']).doUpdateSet({
              contribution_revision: registration.revision,
              policy_revision: policyRevision,
            }),
          )
          .execute()
        return { agentId: id, registrationRevision: registration.revision, policyRevision }
      })
    },
  }
  return service
}

/** A later ordinary policy edit invalidates review instead of silently discarding constraints. */
export async function readBoundAgentRevisions(
  db: Kysely<AppDatabase>,
  userId: string,
  ids: readonly string[],
) {
  if (!ids.length) return new Map<string, number>()
  const bindings = await db
    .selectFrom('capability_policy_binding as binding')
    .innerJoin('capability_policy_revision as policy', (join) =>
      join
        .onRef('policy.user_id', '=', 'binding.user_id')
        .onRef('policy.agent_id', '=', 'binding.agent_id')
        .onRef('policy.revision', '=', 'binding.policy_revision'),
    )
    .select(['binding.contribution_id', 'binding.agent_id', 'binding.contribution_revision'])
    .where('binding.user_id', '=', userId)
    .where('binding.contribution_id', 'in', ids)
    .execute()
  return new Map(
    bindings
      .filter((row) => row.agent_id === row.contribution_id)
      .map((row) => [row.contribution_id, row.contribution_revision]),
  )
}
