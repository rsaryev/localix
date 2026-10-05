import type { Kysely } from 'kysely'
import { stableStringify } from '@localixai/agent'
import type { AppDatabase } from '../../db/types'
import type { RegisteredContribution } from '../ext/contribution-store'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { capabilityRuleSchema } from '../capabilities/rule-schema'
import { createRegistrationPolicyService, readBoundAgentRevisions } from './registration-policy'
import { agentContributionSchema } from './contribution'
import { upgradeAgentPreset } from '../capabilities/seed-agent-presets'

/** A verified bundled declaration can seed defaults; later user policy never gets overwritten. */
export async function seedBundledAgentContribution(
  db: Kysely<AppDatabase>,
  userId: string,
  entry: RegisteredContribution,
) {
  if (entry.kind !== 'agent') return
  const contribution = agentContributionSchema.parse(entry.value)
  const sources = createCapabilitySourceRepository(db, 'agent')
  const state = await sources.get(userId, entry.projectId, entry.id)
  if (state?.config.bundledRegistrationRevision === entry.revision) return
  const policies = createCapabilityRuleRepository(db)
  const current = await policies.readSnapshot(userId, entry.id)
  const defaults = [
    ...contribution.policyProposals,
    { action: `agent:${entry.id}`, resource: '*', effect: 'allow' as const },
  ]
  const baseline = capabilityRuleSchema.array().safeParse(state?.config.bundledPolicyDefaults)
  const bound = await readBoundAgentRevisions(db, userId, [entry.id])
  const next =
    current.revision === 0 && current.rules.length === 0
      ? defaults
      : upgradeAgentPreset(
          current.rules,
          baseline.success ? baseline.data : undefined,
          defaults,
          entry.id,
        )
  // An instruction-only update can retain review if the shipped policy stayed identical.
  // A changed policy with user edits requires review instead of widening the user's list.
  if (
    next ||
    (bound.has(entry.id) &&
      baseline.success &&
      stableStringify(baseline.data) === stableStringify(defaults))
  ) {
    await createRegistrationPolicyService(db).publish(userId, entry.projectId, entry.id, {
      expectedRegistrationRevision: entry.revision,
      expectedPolicyRevision: current.revision,
      rules: next ?? current.rules,
    })
  }
  await sources.patchConfig(userId, entry.projectId, entry.id, {
    bundledRegistrationRevision: entry.revision,
    bundledPolicyDefaults: defaults,
  })
}
