/**
 * WHAT MAY RUN — one rule shape for every question, and one way to answer it.
 *
 * A capability switch and a permission rule turned out to be the same thing said twice. "The
 * `Bash` tool is off here" is `tool:Bash` over resource `*` with effect `deny`; "ask before
 * `git push`" is `tool:Bash` over resource `git push*` with effect `ask`. Modelling them
 * separately meant two tables, two resolvers, and two chances to disagree.
 *
 * ONE LIST, AND THE LAST MATCH WINS. There is no chain and no composition: the rules of the
 * agent whose turn it is are the whole policy. A list is ordered from general to specific —
 * `tool:Bash * allow` then `tool:Bash rm * deny` means "bash is fine, except rm" — so a later
 * row is the more specific statement and it decides.
 *
 * What used to be here was a three-scope chain (global → project → agent) composed by taking
 * the STRICTEST verdict. It bought monotonicity: nothing below could re-enable what something
 * above forbade. It cost more than it bought. "Usually not, but here yes" was inexpressible,
 * every reader had to know which half of the chain it was allowed to consult, and the same
 * question had three places to be answered from — so "why is this tool off" was a search
 * rather than a read. A user who wants a narrower agent makes one; that is what an agent IS.
 */

/** The three answers a rule can give. No strictness order: nothing composes any more. */
export const EFFECTS = ['allow', 'ask', 'deny'] as const
export type Effect = (typeof EFFECTS)[number]

/**
 * One rule.
 *
 * `action` names the capability (`tool:Bash`, `plugin:office`, `mcp:github/create_pr`);
 * `resource` narrows it to particular arguments, and `*` means the capability itself. Both
 * accept `*` wildcards, so one row can switch off a whole family: `tool:*`, `mcp:github/*`.
 */
export interface Rule {
  action: string
  resource: string
  effect: Effect
  /** Shown when the rule blocks or prompts. */
  message?: string
  /**
   * What the PERSON reads when this rule refuses a call. `message` is written to the model
   * ("Investigate with reads, then present the plan…"); a built-in rule that addresses the
   * model gives the transcript its own short sentence here. Runtime-only: never stored.
   */
  personMessage?: string
  /**
   * Who wrote the rule when it was not the user by hand. Provenance for the Capabilities
   * screen ("proposed by the agent in LOCALIX-4", with a way back); never read by `evaluate`.
   */
  origin?: RuleOrigin
}

export interface RuleOrigin {
  kind: 'agent-proposal'
  sessionId: string
  proposalId: string
  /** ISO timestamp of the approval. */
  at: string
}

/**
 * Glob match with `*` standing for any run of characters.
 *
 * Deliberately not a full glob: a capability name is a flat token and a resource is a command
 * line or a path, and `?`/`[...]` classes buy nothing here while making a stored pattern hard
 * to reason about at a glance.
 *
 * Nor is it the PATH glob of permission-rule paths (`cc-settings/path-glob.ts`, picomatch).
 * One resource pattern is matched against the call's commands AND its paths
 * (`agent-core/capability-call-match.ts`), and for a command `*` has to span `/` and spaces:
 * `rm *` must cover `rm -rf /tmp/x`, where a path glob's `*` stops at the first `/` — so a deny
 * rule would quietly stop matching. Here `*` is any run of characters, newlines included (a
 * path may contain one, and `.` alone would let `/secret/a\nb` slip past `/secret/*`), as
 * `docs/features/permissions.md` states the grammar.
 *
 * ONE exception to the plain glob, for the shape a command rule is always written in: a
 * pattern ending in ` *` also matches the bare head. `git *` means "the git command", and a
 * reader who writes it does not mean "git with arguments, but not `git` alone" — yet that is
 * what `^git .*$` says. The same spelling is what a session grant derives (`bash(git)` →
 * `git *`), so without this a grant approved from a card showing `git status` asked again for
 * a bare `git`.
 */
export function matches(pattern: string, value: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith(' *') && value === pattern.slice(0, -2)) return true
  if (!pattern.includes('*')) return pattern === value
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 's').test(value)
}

/**
 * The matching rule, or undefined when the list says nothing about this call.
 *
 * LAST match wins, because a list is ordered from general to specific. Taking the strictest
 * instead would make the general rule unreachable and turn every allowlist with one exception
 * into a blanket denial.
 */
export function verdictIn(
  rules: readonly Rule[],
  action: string,
  resource: string,
): Rule | undefined {
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const rule = rules[i]!
    if (matches(rule.action, action) && matches(rule.resource, resource)) return rule
  }
  return undefined
}

/** The answer, and the rule responsible for it. */
export interface Verdict {
  effect: Effect
  /** The rule that produced this effect; absent when nothing matched. */
  rule?: Rule
}

/**
 * What the rules say about one (action, resource), or the fallback when they say nothing.
 *
 * The fallback is a single value rather than a per-kind table because "no rule mentions it"
 * now has exactly one meaning everywhere: allowed. A kind that must not start running on its
 * own — a dropped-in plugin — is not expressed by a different default here but by the trust
 * class it carries into `resource`, which a rule can then name.
 */
export function evaluate(
  rules: readonly Rule[],
  action: string,
  resource: string,
  fallback: Effect,
): Verdict {
  const rule = verdictIn(rules, action, resource)
  return rule ? { effect: rule.effect, rule } : { effect: fallback }
}
