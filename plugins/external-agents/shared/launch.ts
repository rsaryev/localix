/**
 * The launch DECLARATION format — the one string both halves of the live path depend on.
 *
 * The UI writes it into a terminal profile's command; the backend reads it back off the pane the
 * `bash` tool opened (`backend/live/launch-kinds.ts`) and that is the only thing that tells an
 * observer which agent kind is running there. If the two ever disagree the plugin does not fail
 * loudly: terminals open, agents run, and nothing is ever adopted as a delegation.
 *
 * It lived only in the UI, and every parser test wrote the line out by hand — so the contract was
 * checked against a restatement of itself. Both sides derive from here now, and one test drives the
 * real emitter through the real parser, which is the only arrangement that can catch a drift.
 *
 * WHY AN ENV DECLARATION rather than sniffing the executable: a wrapper, a shim or a version
 * manager hides the real binary, so the launcher declares its intent instead of leaving the
 * observer to infer it.
 */

import type { ProviderId } from './identity'

/** Agent kind, read back by `detectLaunchKind`. Must match a `ProviderAdapter.id`. */
export const LAUNCH_AGENT_VAR = 'LOCALIX_AGENT'
/** Working directory, read back by `detectLaunchCwd`. Optional — correlation narrows by it. */
export const LAUNCH_CWD_VAR = 'LOCALIX_AGENT_CWD'

/**
 * The command a terminal profile runs.
 *
 * The executable is passed BARE on purpose: it resolves through the user's login shell exactly as
 * typing the name would, including a version manager's shim. A missing binary therefore surfaces as
 * the shell's own "command not found" inside the pane the click just opened, which beats a
 * pre-flight probe that can disagree with the shell that will actually run it.
 */
export function agentLaunchCommand(input: {
  readonly provider: string
  readonly executable: string
  /** Included only when a caller has a directory to declare; correlation is unambiguous with it. */
  readonly cwd?: string
}): string {
  const cwd = input.cwd?.trim()
  // Single-quoted because a project path may contain spaces, and the parser accepts that form.
  const cwdPart = cwd ? `${LAUNCH_CWD_VAR}='${cwd}' ` : ''
  return `${LAUNCH_AGENT_VAR}=${input.provider} ${cwdPart}${input.executable}`
}

/**
 * The agent CLIs this plugin can start, as DATA — provider id, human label, executable name.
 *
 * Lives in `shared/` because both halves need it and neither may own it: the UI builds the
 * quick-action menu from it, and the backend probes PATH for the same executables to decide which
 * of those actions is worth offering. It used to live in the UI beside the brand marks, so the
 * backend had no way to name the binary it was being asked about.
 *
 * `provider` must match a `ProviderAdapter.id` — that is what makes a pane the user launched and
 * the roster row it produces one thing. `adapters/registry` is checked against this list in
 * `agentLaunchers.test.ts`, in BOTH directions: an adapter with no launcher is a provider nobody
 * can start, and it fails as an absence rather than an error.
 */
export interface AgentLauncher {
  readonly provider: ProviderId
  readonly label: string
  /** Executable name, resolved through the user's login shell — never an absolute path. */
  readonly executable: string
  /**
   * The vendor's install page. A machine with no agent CLI used to get one disabled sentence and
   * nowhere to go; the menu offers these instead. Omitted when there is no canonical page.
   */
  readonly installUrl?: string
}

export const AGENT_LAUNCHERS: readonly AgentLauncher[] = [
  {
    provider: 'claude-code',
    label: 'Claude Code',
    executable: 'claude',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
  },
  {
    provider: 'codex',
    label: 'Codex',
    executable: 'codex',
    installUrl: 'https://github.com/openai/codex#quickstart',
  },
  {
    provider: 'opencode',
    label: 'opencode',
    executable: 'opencode',
    installUrl: 'https://opencode.ai/docs/',
  },
  {
    provider: 'gemini-cli',
    label: 'Gemini CLI',
    executable: 'gemini',
    installUrl: 'https://github.com/google-gemini/gemini-cli#quick-install',
  },
  {
    provider: 'github-copilot',
    label: 'GitHub Copilot',
    executable: 'copilot',
    installUrl: 'https://github.com/github/copilot-cli',
  },
  { provider: 'hermes', label: 'Hermes', executable: 'hermes' },
]

/**
 * One launcher plus whether its CLI is actually installed on this machine.
 *
 * The wire shape of `GET /launchers`. `available` is measured — see `backend/launch/availability.ts`
 * — and it is what the quick-action menu filters on, so an agent the person does not have is not
 * offered at all rather than offered and then failing inside a pane they just opened.
 */
export interface AgentCliStatus extends AgentLauncher {
  readonly available: boolean
  /** The absolute path the probe resolved. Diagnostics only — the command still runs it BARE. */
  readonly path?: string
}
