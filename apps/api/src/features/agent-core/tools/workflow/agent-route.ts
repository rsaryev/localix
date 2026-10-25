import { availableParallelism } from 'node:os'

import { envInt } from '../../../../lib/env'

/**
 * How many of a workflow's agents run at once. Which model and effort an agent runs on is
 * `agentModelRoute` (`agent-core/agent-model-route.ts`), the same for a workflow agent as for a
 * delegated child or a seat.
 */

/** Claude Code's default and its ceiling for a workflow's concurrent agents. */
const DEFAULT_CONCURRENCY = 16
const MAX_CONCURRENCY = 256

/**
 * How many of one run's agents run at once: Claude Code's limit — up to 16, fewer on a machine
 * with fewer CPUs (two are left for everything else), and `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`
 * (1–256) when it is set. `LOCALIX_WORKFLOW_MAX_CONCURRENT_AGENTS` wins over both.
 */
export function workflowConcurrency(
  env: Record<string, string | undefined> = process.env,
  cpus = availableParallelism(),
): number {
  const set =
    envInt('LOCALIX_WORKFLOW_MAX_CONCURRENT_AGENTS', 0, env) ||
    envInt('CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS', 0, env)
  if (set > 0) return Math.min(MAX_CONCURRENCY, set)
  return Math.max(1, Math.min(DEFAULT_CONCURRENCY, cpus - 2))
}
