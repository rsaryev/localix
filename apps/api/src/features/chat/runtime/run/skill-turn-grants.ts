import { claudeCodeDenyRules } from '../../../cc-settings/cc-rule-translate'
import type { PermissionRule } from '../../../agent-core/permission-engine'
import type { DiscoveredSkill } from '../../../agent-core/skill-discovery'
import { skillToolPathVars, substituteToolPathVars } from '../../../agent-core/skill-tool-path-vars'
import { userHome } from '../../../../lib/env'
import { pluginDataDir } from '../../../plugins/mcp'
import { skillPermissionRules } from './permission-gate-build'
import type { SkillCommandPolicyRef } from './skill-tool-ports'

/**
 * A skill the MODEL loads applies its tool lists to the rest of the run, as one typed `/name` does
 * for its turn (skills.md: `allowed-tools` pre-approve "during the turn that invokes this skill",
 * `disallowed-tools` are removed "while this skill is active").
 *
 * The run's verdict options are its own (`permission-gate-build.ts` builds them per run), so the
 * grant is appended to them: `allowed-tools` to the pre-approvals, which answer only the catch-all
 * question and never open a denied capability; `disallowed-tools` as deny rules after the
 * authored ones, so they win. The next run starts from the authored lists again.
 */
export function applySkillTurnGrants(
  policy: SkillCommandPolicyRef | undefined,
  skill: Pick<DiscoveredSkill, 'name' | 'allowedTools' | 'disallowedTools'> &
    Partial<Pick<DiscoveredSkill, 'path' | 'pluginRoot' | 'pluginName'>>,
  projectDir: string,
): void {
  const options = policy?.current
  if (!options) return
  const vars = skillToolPathVars({
    projectDir,
    path: skill.path,
    pluginRoot: skill.pluginRoot,
    pluginDataDir: skill.pluginName ? pluginDataDir(skill.pluginName, userHome()) : undefined,
  })
  const allowed = substituteToolPathVars(skill.allowedTools, vars)
  if (allowed?.length) {
    const grants = options.preapprovedRules as PermissionRule[] | undefined
    if (grants) grants.push(...skillPermissionRules(allowed, options.root))
    else options.preapprovedRules = skillPermissionRules(allowed, options.root)
  }
  const message = `The skill ${skill.name} removed this tool while it is active (disallowed-tools).`
  for (const spec of substituteToolPathVars(skill.disallowedTools, vars) ?? [])
    (options.rules as PermissionRule[]).push(
      ...claudeCodeDenyRules(spec, options.root, undefined, message),
    )
}
