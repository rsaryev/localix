/**
 * The tool ports a chat host wires in production, built from the REAL factories with inert
 * collaborators. Test-only.
 *
 * The defect this stops: the schema budget and the goldens used to be measured on a registry
 * of name-only stubs (`memory`, `jobs` … at ~33 tokens each), with `vault`,
 * `configure`, `context_budget` and `plugin_build` missing and `bash` built without its
 * terminal fields. The ratchet read 6.4k while a real chat turn paid for every schema it was
 * not counting, so a description could grow past the budget and the test stayed green.
 *
 * Every factory here is the one `runtime-tools.ts` reaches; only its collaborators are fakes,
 * and none of them is called while a tool is BUILT, which is all the prompt and the budget
 * read. A tool whose schema depends on its host (bash's PTY fields, `configure`'s change
 * union, `tool_output`'s action set) gets the host shape production gives it.
 */
import type { AgentTool } from '@localixai/agent/agents'
import { createRemedyRegistry } from '../../config-proposals/registry'
import { createVaultTool } from '../../secrets/agent-tool'
import { createExternalAgentSessionsTool } from '../../external-agents/backend/agent-tool'
import type { AgentSessionsService } from '../../external-agents/backend/service'
import type { CoreToolDeps, OptionalToolPorts } from '../tool-registry'
import { createSkillTool } from '../tools/skill'
import { createMemoryTool } from '../tools/memory/memory'
import { createHistorySearchTool } from '../tools/history/history-search'
import { createToolOutputTool } from '../tools/context-search/context-search'
import { createJobsTool } from '../tools/bash/jobs'
import { createContextBudgetTool } from '../tools/context-budget'
import { createSkipAnswerTool } from '../tools/skip-answer'

/** A collaborator no factory touches at construction; calling into it would be a harness bug. */
const inert = <T>(): T =>
  new Proxy(
    {},
    {
      get: (_target, key) => {
        throw new Error(`production-ports: inert collaborator read at build time (${String(key)})`)
      },
    },
  ) as T

/** The optional bag a chat run holds when every host capability is composed. */
export function productionOptionalPorts(
  setTopic: OptionalToolPorts['set_topic'],
): OptionalToolPorts {
  return {
    context_budget: createContextBudgetTool(() => undefined),
    memory: createMemoryTool(inert(), 'user-1', 'project-1', 'session-1'),
    history_search: createHistorySearchTool(inert(), 'user-1'),
    tool_output: createToolOutputTool(inert(), inert(), 'user-1', 'session-1'),
    skill: createSkillTool(),
    jobs: createJobsTool(inert(), { terminalInput: true }),
    fork: inert(),
    agents: inert(),
    loops: { userId: 'user-1', sessionId: 'session-1', agentId: 'agent-1' },
    plugin_build: { run: async () => ({ text: '', ok: true }) },
    browser: inert(),
    set_topic: setTopic,
    skip_answer: createSkipAnswerTool(),
    configure: {
      sessionId: 'session-1',
      // The change union IS schema; the rest of the host is only called by a proposal.
      host: { changeSchema: createRemedyRegistry().changeSchema } as never,
      ledgerRef: {},
      declined: new Set<string>(),
    },
  }
}

/**
 * The core bag's HOST fields that change a schema. `terminalControl` is what adds bash's
 * interactive-PTY fields; the wait host and the PTY job host change behavior only, and are
 * here so the bash instance is the one a chat run builds.
 */
export function productionCoreDeps(): CoreToolDeps {
  return {
    terminalControl: inert(),
    bashWaitHost: inert(),
    spawnTerminalJob: inert(),
  }
}

/** Host-owned tools injected through the same extraTools seam as their production instances. */
export function productionExtraTools(): AgentTool[] {
  return [
    createVaultTool(inert()) as unknown as AgentTool,
    createExternalAgentSessionsTool({} as AgentSessionsService, Promise.resolve(), 'test-session'),
  ]
}
