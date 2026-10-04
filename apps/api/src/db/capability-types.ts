// Row type for the capability rule table. Split out of `types.ts` only for size; it belongs
// to the same registry, which re-exports it.

/**
 * One statement about what an agent may run.
 *
 * A switch and a permission rule are the same shape: `tool:bash` over resource `*` with
 * effect `deny` turns the tool off, while the same action over `git push*` with effect `ask`
 * leaves it on and prompts. `position` orders the list from general to specific — the LAST
 * match wins, so an exception is stated after the rule it excepts.
 *
 * Keyed by `agent_id` and nothing else. It used to be a `scope` string — `global`,
 * `project:<id>` or `agent:<id>` — whose three layers the resolver composed by taking the
 * strictest verdict. One key means a read is a read: no chain to assemble and no second place
 * the same question can be answered from. A role narrower than another is a different agent.
 *
 * An agent's limits are stored here and not on its record file: a record is a portable role
 * definition, and what it is ALLOWED belongs to the installation it runs in.
 */
export interface CapabilityRuleTable {
  user_id: string
  agent_id: string
  position: number
  /** The capability: `tool:bash`, `plugin:office`, `mcp:github/create_pr`, `tool:*`. */
  action: string
  /** What it is used ON. `*` means the capability itself, so the row is a switch. */
  resource: string
  /** `allow` | `ask` | `deny`. */
  effect: string
  /** Shown when the rule blocks or prompts. */
  message: string | null
  /**
   * Who wrote the row when it was not the user by hand — JSON of `RuleOrigin`
   * (`capabilities/rule.ts`). `null` = authored in Settings. Provenance only: it never
   * takes part in a verdict.
   */
  origin_json: string | null
}

/** One agent-proposed configuration change and what the human decided about it. */
export interface ConfigProposalsTable {
  id: string
  user_id: string
  session_id: string
  remedy_id: string
  title: string
  change_json: string
  /** The agent whose rules the proposal targets — the one that asked. */
  agent_id: string
  /** `approved` | `declined` | `applied` | `failed` | `expired`. */
  status: string
  error: string | null
  created_at: string
  decided_at: string | null
}
