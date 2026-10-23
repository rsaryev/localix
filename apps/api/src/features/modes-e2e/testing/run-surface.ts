/**
 * ONE RUN'S PERMISSION SURFACE, assembled the way a chat run assembles it, for a mode.
 *
 * The path is production's, link by link, so a matrix over it tests the product rather than a
 * model of it: `capabilitiesInMode` (stages/context.ts) → `projectCapabilities` over the built-in
 * and plugin roster (prompt-context.ts) → `createPermissionGate`
 * (permission-gate-build.ts) over the tools the registry built. Only two seams differ, both
 * stated: the confirm requester records the question instead of showing a card (so an `ask` is
 * observable in every mode, including the one whose production gate has no requester), and the
 * host-root guard is given no roots (the fixture workspace is not Localix's own tree).
 */
import type { AgentTool, CallClass } from '@localixai/agent/agents'

import { createPermissionGate } from '../../agent-core/permission-engine'
import { resolveRunProfile, type AgentSessionKind } from '../../agent-core/run-shape'
import {
  productionCoreDeps,
  productionExtraTools,
  productionOptionalPorts,
} from '../../agent-core/testing/production-ports'
import { BUILTIN_TOOL_NAMES } from '../../agent-core/tool-names'
import { createRuntimeToolRegistry } from '../../agent-core/tool-registry'
import type { PlanToolOptions } from '../../agent-core/tools/plan/plan'
import { capabilitiesInMode } from '../../capabilities/permission-mode-policy'
import type { PermissionMode } from '../../../contracts/permission-modes'
import { composeCapabilities, NO_ROSTERS, projectCapabilities } from '../../capabilities/resolve'
import type { Rule } from '../../agent-core/capability-rule'
import { WORKSPACE, type CallCase } from './core-call-cases'

export type Decision = 'allow' | 'ask' | 'deny'

/** The conversation's plan directory and file in the fixture workspace (`plans/plan-paths.ts`). */
export const PLAN_DIR = `${WORKSPACE}/.localix/plans/LOCALIX-1`
export const PLAN_DRAFT = `${PLAN_DIR}/PLAN.md`

/** A plan port whose only live answer is the mode: what `present` checks before anything else.
 *  `presented` records what reached the host, so a refusal is provably a refusal. */
export function planPortFor(mode: PermissionMode, presented: string[] = []): PlanToolOptions {
  return {
    inPlanMode: async () => mode === 'plan',
    present: async (input) => {
      presented.push(input.title ?? '(draft)')
      const plan = {
        id: 'plan-1',
        sessionId: 'root',
        version: 1,
        status: 'presented' as const,
        title: input.title ?? 'Plan',
        body: input.body ?? '',
        authorAgentId: 'agent-1',
        approvedMode: null,
        createdAt: '2026-10-03T00:00:00.000Z',
        decidedAt: null,
        completedAt: null,
        completionSummary: null,
        dismissedBy: null,
        filePath: `${WORKSPACE}/.localix/plans/LOCALIX-1/v1.md`,
      }
      return { outcome: 'presented', plan }
    },
    overview: async () => ({
      plans: [],
      draft: { path: PLAN_DRAFT, exists: false, changed: false },
    }),
    complete: async () => {
      throw new Error('modes-e2e: nothing is approved')
    },
  }
}

/** The registry a host builds for this session kind, mode and denial list, with plugin tools. */
export function runRegistry(
  sessionKind: AgentSessionKind,
  mode: PermissionMode,
  disabledTools: readonly string[],
  pluginTools: readonly AgentTool[] = [],
  plan: PlanToolOptions = planPortFor(mode),
) {
  return createRuntimeToolRegistry({
    policy: {
      agentProfile: resolveRunProfile({ sessionKind }),
      extraTools: [...productionExtraTools(), ...pluginTools],
      disabledTools,
    },
    core: productionCoreDeps(),
    optional: {
      ...productionOptionalPorts({ save: async () => {} }),
      plan,
    },
  })
}

export interface ModeSurface {
  mode: PermissionMode
  humanReachable: boolean
  /** Of the roster, what the projection removes — never built, never on the wire. */
  denied: readonly string[]
  decide(tool: AgentTool, input: unknown): Promise<Decision>
}

/** The agent's rules under `mode`, projected over `rosterExtra` plugin names plus the catalog. */
export function modeSurface(
  rules: readonly Rule[],
  mode: PermissionMode,
  rosterExtra: readonly string[],
): ModeSurface {
  const { capabilities, humanReachable } = capabilitiesInMode(composeCapabilities(rules), mode)
  const projection = projectCapabilities(capabilities, {
    ...NO_ROSTERS,
    tool: [...BUILTIN_TOOL_NAMES, ...rosterExtra],
  })
  const permissions = projection.permissions
  return {
    mode,
    humanReachable,
    denied: projection.denied.tool,
    async decide(tool, input) {
      let asked = false
      const gate = createPermissionGate({
        rules: permissions,
        toolsByName: new Map([[tool.name, tool]]),
        root: WORKSPACE,
        hostRoots: [],
        // The fixture conversation's plan directory, as `ownPlanDirForRun` names a root run's.
        ownPlanDir: PLAN_DIR,
        requestConfirm: async () => {
          asked = true
          return false
        },
      })
      const result = await gate({ toolCallId: 'call-1', toolName: tool.name, input })
      if (asked) return 'ask'
      return result?.block ? 'deny' : 'allow'
    },
  }
}

const REACHES_PAST_CONVERSATION: ReadonlySet<CallClass['effect']> = new Set([
  'files',
  'host',
  'external',
])

/**
 * THE DECISION TABLE, written from the modes' contract rather than read off the engine.
 *
 *   default     the preset's own answer: a tool off its closed list is removed; a path outside
 *               the workspace and a destructive shell command are asked about; the rest runs.
 *   plan        default, except that every call reaching past the conversation is refused.
 *   bypass      no question survives; the closed list does; catastrophic damage is refused.
 *   autonomous  bypass, and whatever waits on a person is refused.
 *
 * `onRoster` is the preset's closed list, stated by the caller from the preset's definition.
 */
export function expectedDecision(
  mode: PermissionMode,
  onRoster: boolean,
  call: Pick<CallCase, 'tool' | 'cls' | 'facts'>,
): Decision | 'removed' {
  if (!onRoster) return 'removed'
  const facts = call.facts ?? {}
  const preset: Decision =
    facts.outside || (call.tool === 'bash' && facts.dangerous) ? 'ask' : 'allow'
  switch (mode) {
    case 'default':
      return preset
    case 'plan':
      return REACHES_PAST_CONVERSATION.has(call.cls.effect) ? 'deny' : preset
    case 'bypass':
      return facts.catastrophic ? 'deny' : 'allow'
    case 'autonomous':
      return facts.catastrophic || call.cls.needsHuman ? 'deny' : 'allow'
  }
}
