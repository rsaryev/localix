/**
 * Session E2E scenarios: real conversations through the HTTP API, asserted on what a person sees
 * (the transcript, the session) and on what each model request carried (prompt, tools, context).
 *
 * Each scenario opens its own sessions, so they run in any order and alone (`--grep`). Add one
 * whenever a change moves how a run is assembled or routed: the name says the behaviour, and a
 * failed assertion names the request or row that broke it.
 */
import { GROUP_SCENARIOS } from './scenarios-group.mjs'
import { QUEUE_SCENARIOS } from './scenarios-queue.mjs'
import { ROUTING_SCENARIOS } from './scenarios-routing.mjs'
import { RUN_SCENARIOS } from './scenarios-runs.mjs'

export const SCENARIOS = [
  ...GROUP_SCENARIOS,
  ...ROUTING_SCENARIOS,
  ...RUN_SCENARIOS,
  ...QUEUE_SCENARIOS,
]
