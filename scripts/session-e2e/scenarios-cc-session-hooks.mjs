/**
 * Session E2E: Claude Code session, prompt and lifecycle hooks, asserted against
 * https://code.claude.com/docs/en/hooks.md (each assertion quotes its line). Every hook is an sh
 * script that appends the JSON it read on stdin to `<root>/cc-session-out/<plugin>/<tag>.jsonl`
 * (and its env to `<tag>.env`), so a scenario asserts on exactly what the hook received.
 */
import { CC_SESSION_HOOK_START_PROMPT_SCENARIOS } from './scenarios-cc-session-hooks-start-prompt.mjs'
import { CC_SESSION_HOOK_STOP_SUBAGENT_SCENARIOS } from './scenarios-cc-session-hooks-stop-subagent.mjs'
import { CC_SESSION_HOOK_PROJECT_TEAM_SCENARIOS } from './scenarios-cc-session-hooks-project-team.mjs'
import { CC_SESSION_HOOK_HANDLER_TYPE_SCENARIOS } from './scenarios-cc-session-hooks-handler-types.mjs'

export const CC_SESSION_HOOK_SCENARIOS = [
  ...CC_SESSION_HOOK_START_PROMPT_SCENARIOS,
  ...CC_SESSION_HOOK_STOP_SUBAGENT_SCENARIOS,
  ...CC_SESSION_HOOK_PROJECT_TEAM_SCENARIOS,
  ...CC_SESSION_HOOK_HANDLER_TYPE_SCENARIOS,
]
