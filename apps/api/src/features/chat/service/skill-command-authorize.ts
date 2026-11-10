import type { AgentTool } from '@localixai/agent/agents'
import type { PermissionRule } from '../../agent-core/permission-engine'
import { verdictOf } from '../../agent-core/permission-verdict'
import { classifyBashCall } from '../../agent-core/tools/bash/bash-call-class'
import { TOOL } from '../../agent-core/tool-names'
import { claudeCodeHome } from '../../cc-settings/config-dir'
import type { SkillShellAnswer } from '../../plugins/kit'
import { runOuterRules } from '../runtime/run/claude-code-permissions'
import { withAllowedTools } from '../runtime/run/permission-gate-build'
import type { AuthorizeSkillCommand } from './skill-commands'

/**
 * The agent's permission rules as a shell call's verdict, with a command's own `allowed-tools`
 * pre-approving (skills.md, "Permission checks on injected commands"). Typing the command is not
 * consent to a command a rule refuses. The model loading a skill meets the run's gate instead
 * (`skill-tool-ports.ts`).
 */
function typedVerdict(
  rules: readonly PermissionRule[],
  allowedTools: readonly string[] | undefined,
  root: string,
) {
  const bash = { name: TOOL.Bash, classify: classifyBashCall } as unknown as AgentTool
  const verdict = verdictOf({
    rules,
    outerRules: withAllowedTools(runOuterRules(root, claudeCodeHome()), allowedTools),
    toolsByName: new Map([[TOOL.Bash, bash]]),
    root,
  })
  return (command: string) => verdict(TOOL.Bash, { command })
}

/** A typed skill's commands, as the kit asks for them: the skill's grants come with each call. */
export function typedSkillShellAnswer(
  rules: readonly PermissionRule[],
  root: string,
): SkillShellAnswer {
  return ({ command, grants }) => typedVerdict(rules, grants, root)(command).decision
}

/**
 * A typed plugin command's injected commands (`command-handlers-plugin-command.ts`): a deny
 * aborts, and so does anything but allow unless its own `allowed-tools` pre-approve it.
 */
export function authorizeTypedSkillCommands(
  rules: readonly PermissionRule[],
  allowedTools: readonly string[] | undefined,
  root: string,
): AuthorizeSkillCommand {
  const verdict = typedVerdict(rules, allowedTools, root)
  return (command) => {
    const result = verdict(command)
    if (result.decision === 'allow') return undefined
    const why = result.reason ?? (result.rule ? `rule ${result.rule}` : '')
    return result.decision === 'deny'
      ? `denied${why ? ` (${why})` : ''}`
      : `not pre-approved, it would need approval${why ? ` (${why})` : ''}; allow it in the permission rules or the skill's allowed-tools`
  }
}
