/**
 * What the launch command tells us about the agent a terminal is running.
 *
 * This is DATA for the same reason the detection manifests are: adding a kind must not mean
 * editing a condition. Identifying the foreground process would answer the question, but we
 * cannot see processes from a plugin, so we read the launch command the host already hands us in
 * the bash tool's `result.details.command`.
 *
 * Explicit hints are honoured first: a wrapper such as a sandbox or VM runner hides the real agent
 * behind its own argv, and no amount of pattern matching recovers it.
 *
 * A launch therefore DECLARES what it starts instead of leaving us to recover it:
 * `LOCALIX_AGENT=<provider>` and `LOCALIX_AGENT_CWD=<path>` lead the line (see `shared/launch.ts`,
 * which both the UI launcher and the delegate commands derive from). Each reader below takes one
 * of those declarations; none of them may assume a declaration is present, because the tab-strip
 * launcher (apps/ui features/terminal/model/agentLaunchers.ts) and a hand-typed `claude` emit only
 * some of them, or none.
 */

export interface LaunchKind {
  /** Provider id — must match a `ProviderAdapter.id` so live and historical rows share a namespace. */
  readonly provider: string
  /** Matched against the first meaningful token of the launch command. */
  readonly executables: readonly string[]
}

export const LAUNCH_KINDS: readonly LaunchKind[] = [
  { provider: 'claude-code', executables: ['claude'] },
  { provider: 'codex', executables: ['codex'] },
  { provider: 'opencode', executables: ['opencode'] },
  { provider: 'gemini-cli', executables: ['gemini'] },
  // `copilot` is the CLI's own name; `ghcs` is its alias.
  { provider: 'github-copilot', executables: ['copilot', 'ghcs'] },
  // `hermes-agent` is an alias.
  { provider: 'hermes', executables: ['hermes', 'hermes-agent'] },
]

const ENV_HINT = /(?:^|\s)LOCALIX_AGENT=([A-Za-z0-9._-]+)/

/**
 * Tokens that precede the real executable. Without skipping these, a command produced by the
 * delegation launcher (`bash script.sh … && claude …`) or an env-prefixed one (`FOO=1 codex`)
 * resolves to the wrapper instead of the agent.
 */
const SKIP_TOKEN = /^(?:[A-Za-z_][A-Za-z0-9_]*=|env$|exec$|command$|nohup$|time$)/

export function detectLaunchKind(command: string | undefined): string | undefined {
  if (!command) return undefined

  const hinted = ENV_HINT.exec(command)?.[1]
  if (hinted && LAUNCH_KINDS.some((k) => k.provider === hinted)) return hinted

  for (const token of command.split(/\s+/)) {
    if (!token || SKIP_TOKEN.test(token)) continue
    // Take the basename: `/opt/homebrew/bin/claude` and `claude` are the same agent.
    const base = token.slice(token.lastIndexOf('/') + 1)
    for (const kind of LAUNCH_KINDS) {
      if (kind.executables.includes(base)) return kind.provider
    }
    // Stop at the first token that is a real command: anything later is an argument or a chained
    // command, and matching those would classify `claude` inside a --append-system-prompt string.
    if (!token.startsWith('-')) return undefined
  }
  return undefined
}

/**
 * Read one `NAME=value` declaration out of a launch line.
 *
 * The launcher emits each value as ONE shell word: bare when every character is inert to the
 * shell, single-quoted otherwise, with an embedded apostrophe written as the shell's `'\''`
 * splice. Both shapes have to be accepted, and the bare charset here is exactly the launcher's
 * (`A-Za-z0-9._/-`) so the two halves cannot disagree about which shape a value took.
 *
 * The two names overlap, so both guards matter: `(?:^|\s)` requires the name to START a shell
 * word, and the `=` immediately after it is what stops a read of `LOCALIX_AGENT` from answering
 * with `LOCALIX_AGENT_CWD`'s value.
 */
function readDeclaration(command: string, name: string): string | undefined {
  const quoted = new RegExp(`(?:^|\\s)${name}='((?:[^']|'\\\\'')*)'`).exec(command)
  if (quoted) {
    const value = quoted[1].replaceAll("'\\''", "'")
    // An empty declaration is no declaration: `cwd: ''` would silently narrow correlation to
    // transcripts with no recorded cwd, which is a wrong answer rather than a missing one.
    return value.length > 0 ? value : undefined
  }
  return new RegExp(`(?:^|\\s)${name}=([A-Za-z0-9._/-]+)`).exec(command)?.[1]
}

/**
 * Where the delegation was launched from, as declared by the launcher. Feeds correlate.ts, whose
 * cwd constraint is what disambiguates two agents of the same provider starting seconds apart.
 */
export function detectLaunchCwd(command: string | undefined): string | undefined {
  if (!command) return undefined
  return readDeclaration(command, 'LOCALIX_AGENT_CWD')
}

// A `<provider>#<id>` TAGGED source used to be parsed out of a launch line here. The tag existed
// only because the launcher inlined a webhook report-back protocol into the launch command, and the
// tag was how a report named which of several delegations sent it. That protocol is gone, so
// nothing mints a tag and nothing reads one: two concurrent delegations of the same provider are
// told apart by their terminal, which is the identity the host actually owns.
