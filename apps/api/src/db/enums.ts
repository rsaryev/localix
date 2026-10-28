/**
 * Runtime vocabulary that the DB column types are derived FROM — the effort scale, the mode list,
 * and the one resolver that validates a declared effort. It lived in `types.ts`, which every
 * consumer imports for TYPES only (~1030 files reference `db/types`), so a module that should
 * erase at compile time shipped values and a function instead. Same exports, same behaviour;
 * `types.ts` re-exports them so no call site changes.
 */
/**
 * The reasoning-effort scale, ordered from least to most thinking. `xhigh` sits between `high`
 * and `max` because that is where the providers put it: the model data maps BOTH on Claude
 * Opus 4.7/4.8, Sonnet 5 and Fable 5, while the whole GPT-5.2–5.5 family maps `xhigh` and NOT
 * `max` — so on those models our old top rung silently meant xhigh anyway, and a user who wanted
 * the top level could not name it. models.dev's effort values keep the same order.
 */
export const REASONING_EFFORTS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

/** Every value a declaration may carry, for the message that lists them. */
export const DECLARABLE_REASONING_EFFORTS: readonly string[] = REASONING_EFFORTS

/**
 * Resolve a declared effort string to a value this column can hold — or undefined when it is
 * not one, which callers must treat as "not specified" rather than casting it through.
 *
 * The reason this exists as ONE function: the vocabulary had been hand-copied into two regexes
 * and three warning messages, all of which drifted from the list above in BOTH directions —
 * they rejected `minimal` (a level the runtime and the UI both offer) and accepted `xhigh`
 * (which nothing downstream could carry). Meanwhile the one place that consumed a declared
 * value cast it unchecked, so a typo reached the provider.
 *
 * What a typo actually did there, measured in the runtime of the time rather than assumed — an earlier
 * version of this comment claimed it meant "no thinking", which is wrong on the provider this
 * repo most often runs: an unrecognized level does NOT degrade to "no thinking" — it degrades to
 * provider-dependent nonsense, which is worse to reason about: the runtime clamped it to the LOWEST
 * supported level on the OpenAI family, `mapThinkingLevelToEffort` falls through to
 * `default: "high"` on adaptive Claude models (i.e. MORE thinking than most declarations ask
 * for), Google re-maps a clamped "off" back to "high", and the legacy Anthropic budget path
 * does `budgets[level]` on an unknown key → `maxTokens: NaN`, i.e. a malformed request. So validating is right, but for the stronger reason that the
 * outcome was unpredictable per provider, not uniformly minimal.
 */
export function resolveDeclaredReasoningEffort(
  value: string | undefined,
): ReasoningEffort | undefined {
  const v = value?.trim()
  if (!v) return undefined
  return (REASONING_EFFORTS as readonly string[]).includes(v) ? (v as ReasoningEffort) : undefined
}

// A session used to carry an `AgentMode` — ask / edit / plan / auto / yolo / … — and it
// is gone on purpose. Six values spanned three unrelated questions (which tools a run gets,
// how the agent should behave, how often to confirm), so every consumer read it for a
// different reason and each became a second answer to a question something else already
// answered: a tool switched ON in Capabilities could still be absent from the turn because a
// mode had stripped it.
//
// Each half went to the owner it belonged to. Which tools a run may use: the capability chain
// (global → project → agent), which is the only authority now. How the agent behaves:
// its own instructions. Forking: the `fork` tool, gated like every other tool. How often
// to confirm: the permission rules, whose `ask` effect says
// it directly, plus the per-session "Always allow" grants.

/**
 * Is this a reasoning-effort level a declaration may name?
 *
 * DERIVED, never hand-listed. This used to be a literal regex, and a second copy of it lived in
 * `agent-core/skill-validate.ts` with the same values plus three hand-written "valid values: …"
 * messages. All of them had drifted from the real vocabulary in BOTH directions: they rejected
 * `minimal` (a level the runtime accepts and the model picker offers) and accepted `xhigh`
 * (which the column cannot hold, so it needed normalizing rather than waving through).
 */
export function isDeclarableEffort(value: string): boolean {
  return resolveDeclaredReasoningEffort(value) !== undefined
}

/** The values to name in a warning, so the message cannot drift from the check. */
export const DECLARABLE_EFFORTS_TEXT = DECLARABLE_REASONING_EFFORTS.join(', ')
