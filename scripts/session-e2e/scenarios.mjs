/**
 * Session E2E scenarios: real conversations through the HTTP API, asserted on what a person sees
 * (the transcript, the session) and on what each model request carried (prompt, tools, context).
 *
 * Each scenario opens its own sessions, so they run in any order and alone (`--grep`). Add one
 * whenever a change moves how a run is assembled or routed: the name says the behaviour, and a
 * failed assertion names the request or row that broke it.
 */
import { BOARD_SCENARIOS } from './scenarios-board.mjs'
import { GROUP_SCENARIOS } from './scenarios-group.mjs'
import { HOOK_SCENARIOS } from './scenarios-hooks.mjs'
import { MOD_SCENARIOS } from './scenarios-mods.mjs'
import { PLUGIN_AGENT_SCENARIOS } from './scenarios-plugin-agents.mjs'
import { PLUGIN_SCENARIOS } from './scenarios-plugins.mjs'
import { QUEUE_SCENARIOS } from './scenarios-queue.mjs'
import { ROUTING_SCENARIOS } from './scenarios-routing.mjs'
import { RUN_SCENARIOS } from './scenarios-runs.mjs'
import { WORKFLOW_SCENARIOS } from './scenarios-workflows.mjs'

export const SCENARIOS = [
  ...GROUP_SCENARIOS,
  ...ROUTING_SCENARIOS,
  ...RUN_SCENARIOS,
  ...QUEUE_SCENARIOS,
  ...PLUGIN_SCENARIOS,
  ...PLUGIN_AGENT_SCENARIOS,
  ...WORKFLOW_SCENARIOS,
  ...HOOK_SCENARIOS,
  ...MOD_SCENARIOS,
  ...BOARD_SCENARIOS,
]
