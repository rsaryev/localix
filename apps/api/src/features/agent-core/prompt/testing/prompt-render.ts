/**
 * One deterministic system-prompt render, shared by the golden matrices and the prompt lints.
 * NOT shipped in any runtime path.
 *
 * Everything here is pure and side-effect-free: tool deps are faked (the builders never
 * execute), `now` is fixed, and ids are constant — so a render is byte-stable.
 */
import type { ScriptSandbox } from '@localixai/agent/runtime'
import { resolveRunProfile, type RunProfile } from '../../run-shape'
import { DEFAULT_AGENT_HANDLE } from '../../../../db/participant'
import { BUILTIN_AGENT_TYPES } from '../../../agents/catalog/builtin-types'
import {
  createRuntimeToolRegistry,
  type OptionalToolPorts,
  type RuntimeToolRegistry,
} from '../../tool-registry'
import { buildAgentSystemPrompt, type BuildAgentSystemPromptParams } from '../assemble'
import {
  productionCoreDeps,
  productionExtraTools,
  productionOptionalPorts,
} from '../../testing/production-ports'

const FIXED_NOW = () => '2026-06-01T12:00:00.000Z'

/**
 * The registry a chat host builds when every capability is composed: the real factory of
 * every tool, so the prompt, the roster and the schema budget are all measured on what a run
 * actually carries (see `production-ports.ts` for why stubs were not enough).
 *
 * `withoutPorts` drops host ports a seat is not given: `skip_answer` exists only beside a
 * colleague and `set_topic` only for the topic owner, whatever the rules allow.
 */
export function richRegistry(
  profile: RunProfile,
  disabledTools?: readonly string[],
  withoutPorts: readonly (keyof OptionalToolPorts)[] = [],
  withheldByHost?: Readonly<Record<string, string>>,
  /** The engine's sandbox, for a measure of `codemode`'s real schema; inert by default. */
  scripts?: ScriptSandbox,
): RuntimeToolRegistry {
  const optional = productionOptionalPorts({ save: async () => {} }, scripts)
  for (const port of withoutPorts) delete optional[port]
  return createRuntimeToolRegistry({
    policy: {
      agentProfile: profile,
      extraTools: productionExtraTools(),
      ...(disabledTools ? { disabledTools } : {}),
      ...(withheldByHost ? { withheldByHost } : {}),
    },
    core: productionCoreDeps(),
    optional,
  })
}

/** Common, deterministic optional context strings so the session-stable sections render. */
const SAMPLE_CONTEXT: Partial<BuildAgentSystemPromptParams> = {
  workspaceRoot: '/repo',
  contextFiles: [{ path: '/repo/AGENTS.md', content: 'project rules' }],
  memoryContext: 'user_role: staff engineer',
  memoryUsage: { chars: 582, limit: 2200, pct: 26 },
  skillsContext: 'demo-skill — does the demo thing',
  pinnedSkills: [{ name: 'house-style', content: 'Follow the house style.' }],
  pluginsContext: '',
  scratchDir: '/home/u/.localix/tmp/sessions/s1',
}

/**
 * The session kind each run shape is reached through — the harness renders a shape by
 * dispatching the way production does, rather than reaching for a profile table.
 */
export const SHAPE_SESSION_KIND = {
  orchestrator: 'chat',
  subagent: 'subagent',
  automation: 'job',
} as const satisfies Record<string, 'chat' | 'subagent' | 'job'>

/** The golden/matrix names for the three shapes (`orchestrator` is the chat shape's
 *  model-facing word — see `ROLE_WORD` in `sections/role.ts`). */
export type PromptShapeKey = keyof typeof SHAPE_SESSION_KIND

/** A representative end-to-end prompt for a shape (locks section ORDER). */
export function fullPrompt(
  profileKey: PromptShapeKey,
  extra: Partial<BuildAgentSystemPromptParams> = {},
  disabledTools?: readonly string[],
  withoutPorts?: readonly (keyof OptionalToolPorts)[],
  withheldByHost?: Readonly<Record<string, string>>,
): string {
  // Production parity: every run is dispatched WITH an agent, and the identity slot is that
  // agent's prompt — a chat with the shipped default, an unattended run with whatever its
  // dispatcher resolved. The goldens therefore show the first line a real
  // session gets, instead of an identity-less prompt no host produces.
  //
  // Only the PROMPT is taken from the record, never its tool list: these goldens exist to
  // lock each shape's DEFAULT surface, and an agent's declared tools would substitute one
  // particular agent's narrower list for it. That the declaration wins at dispatch is
  // `run-shape.test.ts`'s to prove; identity reaches the prompt the same way either path.
  // One shipped record answers for every shape now that the task agents are retired: the
  // goldens lock the SHAPE's default surface, and the identity behind them only has to be a
  // real record with real instructions.
  const agent = BUILTIN_AGENT_TYPES.find((type) => type.fullName === DEFAULT_AGENT_HANDLE)
  const profile = resolveRunProfile(
    { sessionKind: SHAPE_SESSION_KIND[profileKey] },
    agent ? { prompt: agent.prompt } : undefined,
  )
  // Production parity (runtime-tools.ts): a session with active loops keeps `loops`
  // direct — the loops section instructs dynamic loops to call `loops.reschedule`.
  const registry = richRegistry(profile, disabledTools, withoutPorts, withheldByHost)
  return buildAgentSystemPrompt({
    sessionId: 'session-1',
    modelId: 'openrouter/anthropic/claude-sonnet-4.5',
    providerId: 'openrouter',
    now: FIXED_NOW,
    agentProfile: profile,
    toolRegistry: registry,
    ...SAMPLE_CONTEXT,
    ...extra,
  })
}
