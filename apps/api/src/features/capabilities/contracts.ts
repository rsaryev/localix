import { z } from 'zod'
import { capabilityRuleSchema } from './rule-schema'

/**
 * WHICH scope a read or a write is about — the one selector every capability route takes.
 *
 * Three scopes, one shape: no field is global, a `projectId` is that project, an
 * `agentId` is that agent. An agent ID selects the stored scope (see `storedScope`), because
 * an agent's rules follow the agent wherever it runs and are not a per-project variant.
 */
export const capabilityScopeSchema = z.object({
  /** '' or absent = the no-project (global) scope. */
  projectId: z.string().optional(),
  /** Registry-issued AgentId. Present = the scope is that agent. */
  agentId: z.string().optional(),
})
export type CapabilityScope = z.infer<typeof capabilityScopeSchema>

export const capabilitySnapshotQuerySchema = capabilityScopeSchema.extend({})
export type CapabilitySnapshotQuery = z.infer<typeof capabilitySnapshotQuerySchema>

/**
 * The composer-tip wire shape lives in its own module (`tip-contracts.ts`) and is
 * re-exported here so every consumer still takes the capability vocabulary from one
 * import. A tip is composed FROM this document; it is not part of describing what a
 * scope can do, and the two change for different reasons.
 */
export type { ComposerTipAction, ComposerTip } from './tip-contracts'

/**
 * ONE capability change — a rule, said plainly.
 *
 * There is no `enabled` on this wire and no per-kind union, because a switch was never a
 * second kind of thing: turning a skill off IS `skill:<name>` over `*` with effect `deny`.
 * Sending a boolean instead meant the server carried a second vocabulary and translated it
 * per kind, and each kind had drifted into its own idea of what "on" writes. The four
 * settings tabs still render a switch; that sugar lives in the client now, which is the only
 * place it can be wrong without the run and the screen disagreeing.
 *
 * `effect` is the ABSOLUTE desired state, never a flip, so a retried request is idempotent
 * and two clients cannot toggle past each other. `default` is the fourth answer and is not
 * `allow`: it removes the row, so the item falls back to its kind's default and then to its
 * own trust gate — which is what keeps a dropped-in plugin inert until somebody says yes.
 */
export const capabilityRuleChangeSchema = z.object({
  /** `tool:Bash`, `skill:deploy`, `mcp:github`, `mcp:github/create_pr`, `plugin:office`… */
  action: z.string().min(1).max(200),
  /** `*` is the capability itself; anything else narrows it to particular arguments. */
  resource: z.string().min(1).max(400).default('*'),
  effect: z.enum(['allow', 'ask', 'deny', 'default']),
})
export type CapabilityRuleChange = z.infer<typeof capabilityRuleChangeSchema>

/** How many changes one request may carry — a bulk edit, not an import channel. */
export const MAX_CAPABILITY_CHANGES = 200

/**
 * Wire contract for `POST /rpc/capabilities/rules/apply` — the ONE way to change what a
 * scope permits, answering with the same document `GET /rpc/capabilities/snapshot` returns.
 *
 * Changes arrive as a LIST because editing is genuinely a set operation (a screen flips
 * several rows in a row), and because one request that applies them all cannot leave the
 * scope halfway between two intended states. They are applied in ONE read-modify-write of
 * the scope's ordered list, whatever kinds they span.
 *
 * Answering with the snapshot is the point: a mutation used to be followed by a second
 * request for the document it had just invalidated, and the pair could interleave with
 * another client's. One request in, one authoritative document out.
 *
 * This is a PATCH by (action, resource). To replace a scope's whole ordered list — which is
 * what the rules editor does, because order is the semantics — use `PUT /rules`.
 */
export const capabilityRulesApplySchema = capabilityScopeSchema.extend({
  changes: z.array(capabilityRuleChangeSchema).min(1).max(MAX_CAPABILITY_CHANGES),
})
export type CapabilityRulesApplyRequest = Omit<
  z.infer<typeof capabilityRulesApplySchema>,
  'changes'
> & { changes: readonly CapabilityRuleChange[] }

/**
 * A scope's OWN permission rules — what it stores, not the composed answer a run evaluates.
 *
 * Editing is always about one scope's own list: the effective set is the maximum over the
 * chain, and a screen that let you edit that composition could not say which scope a change
 * belonged to.
 */
export const capabilityPermissionsQuerySchema = capabilityScopeSchema

export const capabilityRulesSchema = z.object({
  /** The stored scope these rules belong to: `global`, `project:<id>` or `agent:<handle>`. */
  scope: z.string(),
  revision: z.number().int().nonnegative(),
  rules: z.array(capabilityRuleSchema),
  /**
   * The rules this scope ships with, present only for a role the product owns. It is what
   * the editor's Reset writes, and comparing it with `rules` is how the editor knows whether
   * there is anything to reset. Absent means the scope has no default — every scope a user
   * or an extension owns.
   */
  defaults: z.array(capabilityRuleSchema).optional(),
})
export type CapabilityRules = z.infer<typeof capabilityRulesSchema>

export const updateCapabilityRulesSchema = capabilityScopeSchema.extend({
  expectedRevision: z.number().int().nonnegative(),
  rules: z.array(capabilityRuleSchema).max(500),
})
