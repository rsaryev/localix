import type { AgentTool } from '@localixai/agent/agents'
import type { PermissionRule } from '../../agent-core/permission-engine'
import { verdictOf } from '../../agent-core/permission-verdict'
import { classifyBashCall } from '../../agent-core/tools/bash/bash-call-class'
import { TOOL } from '../../agent-core/tool-names'
import { skillPermissionRules } from '../runtime/run/permission-gate-build'
import type { AuthorizeSkillCommand } from './skill-commands'

/**
 * The check a TYPED skill's or plugin command's injected commands meet before any runs, as Claude
 * Code checks them (skills.md, "Permission checks on injected commands"): against the agent's
 * permission rules, as a shell call; a deny aborts, and so does anything but allow unless the
 * skill's own `allowed-tools` pre-approve it. Typing the command is not consent to a command a
 * rule refuses. The model loading a skill meets the run's gate instead (`skill-tool-ports.ts`).
 */
export function authorizeTypedSkillCommands(
  rules: readonly PermissionRule[],
  allowedTools: readonly string[] | undefined,
  root: string,
): AuthorizeSkillCommand {
  const bash = { name: TOOL.bash, classify: classifyBashCall } as unknown as AgentTool
  const verdict = verdictOf({
    rules,
    preapprovedRules: skillPermissionRules(allowedTools, root),
    toolsByName: new Map([[TOOL.bash, bash]]),
    root,
  })
  return (command) => {
    const result = verdict(TOOL.bash, { command })
    if (result.decision === 'allow') return undefined
    const why = result.reason ?? (result.rule ? `rule ${result.rule}` : '')
    return result.decision === 'deny'
      ? `denied${why ? ` (${why})` : ''}`
      : `not pre-approved, it would need approval${why ? ` (${why})` : ''}; allow it in the permission rules or the skill's allowed-tools`
  }
}
