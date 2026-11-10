import { claudeCodeHome } from '../../../cc-settings/config-dir'
import { runOuterRules } from './claude-code-permissions'
import type { SkillCommandPolicyRef } from './skill-tool-ports'

/**
 * A skill the MODEL loads applies its tool lists to the rest of the run, as one typed `/name` does
 * for its turn (skills.md: `allowed-tools` pre-approve "during the turn that invokes this skill",
 * `disallowed-tools` are removed "while this skill is active"). The lists are the kit's
 * expansion's, their `${CLAUDE_*}` paths already filled.
 *
 * The run's verdict options are its own (`permission-gate-build.ts` builds them per run), so the
 * grant is added to their Claude Code rule set: `allowed-tools` answer only the catch-all question
 * and never open a denied capability; `disallowed-tools` refuse whatever the authored list says.
 * The next run starts from the authored lists again.
 */
export function applySkillTurnGrants(
  policy: SkillCommandPolicyRef | undefined,
  skillName: string,
  lists: { readonly grants: readonly string[]; readonly disallowed: readonly string[] },
  projectDir: string,
): void {
  const options = policy?.current
  if (!options) return
  const message = `The skill ${skillName} removed this tool while it is active (disallowed-tools).`
  // The gate holds this set itself: rules added to it hold for the rest of the run.
  const outer = (options.outerRules ??= runOuterRules(options.root ?? projectDir, claudeCodeHome()))
  const where = `the skill ${skillName}'s allowed-tools`
  if (lists.grants.length) outer.add({ rules: [...lists.grants], behavior: 'allow', where })
  if (lists.disallowed.length)
    outer.add({
      rules: [...lists.disallowed],
      behavior: 'deny',
      where: 'disallowed-tools',
      message,
    })
}
