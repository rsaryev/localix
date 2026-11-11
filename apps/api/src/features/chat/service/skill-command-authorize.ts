import type { AgentTool } from '@localixai/agent/agents'
import type { PermissionRule } from '../../agent-core/permission-engine'
import { verdictOf } from '../../agent-core/permission-verdict'
import { classifyBashCall } from '../../agent-core/tools/bash/bash-call-class'
import { TOOL } from '../../agent-core/tool-names'
import { claudeCodeHome } from '../../cc-settings/config-dir'
import type { SkillShellAnswer } from '../../plugins/kit'
import { runOuterRules } from '../runtime/run/claude-code-permissions'
import { withAllowedTools } from '../runtime/run/permission-gate-build'

/**
 * The agent's permission rules as a shell call's verdict, with a command's own `allowed-tools`
 * pre-approving (skills.md, "Permission checks on injected commands"). Typing the command is not
 * consent to a command a rule refuses. The model loading a skill meets the run's gate instead
 * (`skill-tool-ports.ts`).
 */
function typedVerdict(rules: readonly PermissionRule[], grants: readonly string[], root: string) {
  const bash = { name: TOOL.Bash, classify: classifyBashCall } as unknown as AgentTool
  const verdict = verdictOf({
    rules,
    outerRules: withAllowedTools(runOuterRules(root, claudeCodeHome()), grants),
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
