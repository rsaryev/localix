import type {
  Expansion,
  PermissionBehavior,
  PluginSession,
  SkillInvoker,
} from '@rsaryev/llx-plugin'

/**
 * A skill run as Claude Code runs it, from the chat's kit session: its body with `$ARGUMENTS`,
 * `$0`/`$name`, `${CLAUDE_*}` and its `!` commands expanded, the turn's grants, its fork and its
 * model and effort. The kit checks `user-invocable` and `disable-model-invocation`, and registers
 * the skill's frontmatter `hooks` on the session for the rest of it.
 */
export interface InvokedSkill {
  readonly text: string
  /** `allowed-tools`, with their `${CLAUDE_*}` paths filled: pre-approved for the turn. */
  readonly grants: readonly string[]
  /** `disallowed-tools`: removed for the turn. */
  readonly disallowed: readonly string[]
  /** `context: fork`: the subagent type, and whether the caller waits for its result. */
  readonly fork?: { readonly agent: string; readonly wait: boolean }
  readonly model?: string
  readonly effort?: string
}

export type SkillInvocation =
  | { readonly ok: true; readonly skill: InvokedSkill }
  | { readonly ok: false; readonly message: string }

/** The host's answer for one command a skill injects, with the skill's own grants. */
export type SkillShellAnswer = (call: {
  readonly command: string
  readonly grants: readonly string[]
}) => PermissionBehavior

export interface InvokeSkillOptions {
  readonly arguments?: string
  readonly invoker: SkillInvoker
  /** The person named the skill in this message: the model may run a `disable-model-invocation` one. */
  readonly permittedByMention?: boolean
  /** Absent: the session's own rules with the skill's `allowed-tools` added (the kit's default). */
  readonly shellPermission?: SkillShellAnswer
  readonly signal: AbortSignal
}

/** The turn's view with the host's shell answer, its skill folders read again (a skill written since is found). */
async function readyTurn(
  session: PluginSession,
  shellPermission: SkillShellAnswer | undefined,
  signal: AbortSignal,
): Promise<PluginSession> {
  const turn = shellPermission
    ? session.withTurn({ shellPermission: (call) => shellPermission(call) })
    : session
  await turn.reloadSkills({ signal })
  return turn
}

type Refusal = Extract<SkillInvocation, { ok: false }>

const refusal = (expansion: Extract<Expansion, { ok: false }>): Refusal => ({
  ok: false,
  message: expansion.issues.map((issue) => issue.message).join('; '),
})

function invokedOf(expansion: Extract<Expansion, { ok: true }>): InvokedSkill {
  const { execution, turn: overrides } = expansion
  return {
    text: expansion.text,
    grants: expansion.grants,
    disallowed: expansion.disallowed,
    ...(execution.mode === 'fork'
      ? { fork: { agent: execution.agent, wait: !execution.background } }
      : {}),
    ...(overrides.model ? { model: overrides.model } : {}),
    ...(overrides.effort?.level ? { effort: overrides.effort.level } : {}),
  }
}

/** Expands `name` by every name the skill answers to. */
export async function invokeSkill(
  session: PluginSession,
  name: string,
  options: InvokeSkillOptions,
): Promise<SkillInvocation> {
  const { signal } = options
  const turn = await readyTurn(session, options.shellPermission, signal)
  const expansion = await turn.expandSkill(name, {
    arguments: options.arguments ?? '',
    invoker: options.invoker,
    ...(options.permittedByMention ? { permittedByMention: true } : {}),
    signal,
  })
  return expansion.ok ? { ok: true, skill: invokedOf(expansion) } : refusal(expansion)
}

/**
 * A message the person typed: its leading skill and the ones stacked after it (`/a /b args`), each
 * expanded with the shared arguments, in order (skills.md, "Stack several skills in one message").
 * The first refusal stops it. None when no leading name is a skill of the session.
 */
export async function invokeTypedSkills(
  session: PluginSession,
  message: string,
  options: Pick<InvokeSkillOptions, 'shellPermission' | 'signal'>,
): Promise<
  | { readonly ok: true; readonly skills: readonly (InvokedSkill & { readonly command: string })[] }
  | Refusal
> {
  const { signal } = options
  const turn = await readyTurn(session, options.shellPermission, signal)
  const typed = await turn.expandMessage(message, { invoker: 'user', signal })
  const skills: (InvokedSkill & { command: string })[] = []
  for (const { mention, expansion } of typed.expansions) {
    if (!expansion.ok) return refusal(expansion)
    skills.push({ command: mention.command, ...invokedOf(expansion) })
  }
  return { ok: true, skills }
}
