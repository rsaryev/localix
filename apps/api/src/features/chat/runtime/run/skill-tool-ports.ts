import { announceSkillInvoked } from '../../../agent-core/skill-invocations'
import { verdictOf, type VerdictOptions } from '../../../agent-core/permission-verdict'
import { TOOL } from '../../../agent-core/tool-names'
import type { SkillToolPorts } from '../../../agent-core/tools/skill-call'
import { skillCallName } from '../../../agent-core/tools/skill-names'
import { invokeSkill, type KitSession, type SkillShellAnswer } from '../../../plugins/kit'
import type { SessionRecord } from '../../repository'
import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { runOuterRules } from './claude-code-permissions'
import { withAllowedTools } from './permission-gate-build'
import { applySkillTurnGrants } from './skill-turn-grants'

/** The run's permission inputs, filled once its gate is built (`stages/intake.ts`). */
export type SkillCommandPolicyRef = { current?: VerdictOptions }

/**
 * The run's answer for each command a skill injects, with the skill's `allowed-tools` (filled by
 * the kit) pre-approving; a denial still wins over them. A run whose gate is not built yet, or whose
 * agent has no shell, runs nothing: the model must not get a shell through a skill that it does not
 * hold, or that a read-only mode withholds. What an `ask` does (abort, or defer in auto mode) is
 * the kit's.
 */
export function skillShellAnswer(policy: SkillCommandPolicyRef | undefined): SkillShellAnswer {
  return ({ command, grants }) => {
    const options = policy?.current
    if (!options || !options.toolsByName.has(TOOL.Bash)) return 'deny'
    const outer = options.outerRules ?? runOuterRules(options.root ?? '/', claudeCodeHome())
    return verdictOf({ ...options, outerRules: withAllowedTools(outer, grants) })(TOOL.Bash, {
      command,
    }).decision
  }
}

/**
 * The host half of the `Skill` tool's `get` (`agent-core/tools/skill.ts`): the chat's kit session
 * expands the skill as Claude Code does when Claude invokes it (`disable-model-invocation`, its
 * commands against the run's rules, its frontmatter `hooks` registered for the rest of the
 * session), its tool lists apply to the rest of the run, and a plugin monitor waiting for it
 * starts. No kit session (a test's runtime): no port, the content as written.
 */
export function skillToolPorts(input: {
  userId: string
  session: SessionRecord
  defaultCwd: string
  kitSession?: KitSession
  /** The run's permission inputs: each command a loaded skill injects is checked against them. */
  commandPolicy?: SkillCommandPolicyRef
}): Pick<SkillToolPorts, 'invokeSkill'> {
  const { userId, session, defaultCwd, kitSession, commandPolicy } = input
  if (!kitSession) return {}
  return {
    invokeSkill: async (skill, request) => {
      const invoked = await invokeSkill(kitSession, skillCallName(skill), {
        arguments: request.arguments,
        invoker: 'model',
        permittedByMention: request.named,
        shellPermission: skillShellAnswer(commandPolicy),
        signal: request.signal ?? new AbortController().signal,
      })
      if (!invoked.ok) return invoked
      const { text, fork, model, effort } = invoked.skill
      applySkillTurnGrants(commandPolicy, skill.name, invoked.skill, defaultCwd)
      announceSkillInvoked({
        userId,
        sessionId: session.rootSessionId ?? session.id,
        skillName: skill.name,
        ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
        ...(defaultCwd ? { cwd: defaultCwd } : {}),
      })
      return {
        ok: true,
        text,
        ...(fork
          ? { fork: { ...fork, ...(model ? { model } : {}), ...(effort ? { effort } : {}) } }
          : {}),
      }
    },
  }
}
