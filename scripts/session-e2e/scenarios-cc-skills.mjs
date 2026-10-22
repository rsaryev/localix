/**
 * Session E2E: Claude Code plugin skills and commands: names, arguments, frontmatter, invocation.
 *
 * The reference is https://code.claude.com/docs/en/skills.md ("skills"),
 * https://code.claude.com/docs/en/plugins/components.md ("components"),
 * https://code.claude.com/docs/en/hooks.md ("hooks") and
 * https://code.claude.com/docs/en/permissions.md ("permissions"). A scenario marked `known`
 * asserts the documented behaviour where Localix still differs.
 */
import { CC_SKILL_INVOCATION_SCENARIOS } from './scenarios-cc-skills-invocation.mjs'
import { CC_SKILL_FRONTMATTER_SCENARIOS } from './scenarios-cc-skills-frontmatter.mjs'
import { CC_SKILL_HOOK_COMMAND_SCENARIOS } from './scenarios-cc-skills-hooks-commands.mjs'

export const CC_SKILL_SCENARIOS = [
  ...CC_SKILL_INVOCATION_SCENARIOS,
  ...CC_SKILL_FRONTMATTER_SCENARIOS,
  ...CC_SKILL_HOOK_COMMAND_SCENARIOS,
]
