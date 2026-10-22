/**
 * Session E2E: Claude Code plugin agents (`agents/*.md`) as the delegable subagent types of a chat:
 * the scoped name, what a delegated child runs with (prompt, tools, model, maxTurns, background),
 * the fields a plugin agent ignores, SubagentStart / SubagentStop hooks (and Stop for the main
 * agent only), the plugin `agent` setting, two plugins' agents of one name, and a disabled
 * plugin's agents.
 *
 * Reference: https://code.claude.com/docs/en/sub-agents.md, /hooks.md and
 * /plugins/components.md (quoted beside each assertion).
 */
import { CC_AGENT_DELEGATION_SCENARIOS } from './scenarios-cc-agents-delegation.mjs'
import { CC_AGENT_HOOK_SCENARIOS } from './scenarios-cc-agents-hooks.mjs'
import { CC_AGENT_SETTING_SCENARIOS } from './scenarios-cc-agents-settings.mjs'

export const CC_AGENT_SCENARIOS = [
  ...CC_AGENT_DELEGATION_SCENARIOS,
  ...CC_AGENT_HOOK_SCENARIOS,
  ...CC_AGENT_SETTING_SCENARIOS,
]
