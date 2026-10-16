/**
 * Deterministic system-prompt rendering harness for the golden-snapshot + dedup
 * tests. NOT shipped in any runtime path — it exists only so the assembled system
 * prompt can be rendered for the full {profile × tool-set} matrix, committed as
 * readable golden `.txt` files, and linted for cross-section duplication.
 *
 * The matrix used to have a MODE axis. It is gone with modes themselves: what a prompt
 * varies with is the TOOLS the run ended up holding, which is what every section here
 * gates on, so the axes are the run shape and the switches that change the tool set.
 *
 * Everything here is pure and side-effect-free: tool deps are faked (the builders
 * never execute), `now` is fixed, and ids are constant — so a render is byte-stable.
 */
import { resolveRunProfile, type RunProfile } from '../run-shape'
import { TOOL } from '../tool-names'
import { DEFAULT_AGENT_HANDLE } from '../../../db/participant'
import { builtinAgentRecord } from '../../agents/builtin'
import { createRuntimeToolRegistry, type RuntimeToolRegistry } from '../tool-registry'
import { buildAgentSystemPrompt, type BuildAgentSystemPromptParams } from '../system-prompt'
import {
  productionCoreDeps,
  productionExtraTools,
  productionOptionalPorts,
} from './production-ports'

const FIXED_NOW = () => '2026-06-01T12:00:00.000Z'

/**
 * A NARROWED roster, standing in for what an agent's own capability rules produce.
 *
 * Not a product list — there is no second, session-level switch that trims a run any more. It
 * is a representative set of optional tools an agent might not be given, so the lints can prove
 * every section that names one disappears with it.
 */
const LEAN_ROSTER_DISABLED: readonly string[] = [
  TOOL.memory,
  TOOL.history_search,
  TOOL.vault,
  TOOL.skill,
  TOOL.jobs,
  TOOL.browser,
]

/** A run that does not own the session topic: no `set_topic`, so no topic rules either. */
const SOLO_ROSTER_DISABLED: readonly string[] = [TOOL.set_topic]

/** A conversation with one colleague, from the leader's seat, with the registry beside it. */
const CONVERSATION_CONTEXT: Partial<BuildAgentSystemPromptParams> = {
  conversation: {
    self: 'localix',
    participants: [{ handle: 'localix' }, { handle: 'qa', description: 'Verifies releases' }],
    isLeader: true,
  },
  agentDirectory: [
    {
      id: 'agent-qa',
      handle: 'qa',
      description: 'Verifies releases',
      leadershipPriority: 10,
      inConversation: true,
      available: true,
    },
  ],
}

/**
 * The registry a chat host builds when every capability is composed: the real factory of
 * every tool, so the prompt, the roster and the schema budget are all measured on what a run
 * actually carries (see `production-ports.ts` for why stubs were not enough).
 */
export function richRegistry(
  profile: RunProfile,
  disabledTools?: readonly string[],
): RuntimeToolRegistry {
  return createRuntimeToolRegistry({
    policy: {
      agentProfile: profile,
      extraTools: productionExtraTools(),
      ...(disabledTools ? { disabledTools } : {}),
    },
    core: productionCoreDeps(),
    optional: productionOptionalPorts({ save: async () => {} }),
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
 *  model-facing word — see `ROLE_WORD` in system-prompt-role-sections.ts). */
export type PromptShapeKey = keyof typeof SHAPE_SESSION_KIND

/** A representative end-to-end prompt for a shape (locks section ORDER). */
export function fullPrompt(
  profileKey: PromptShapeKey,
  extra: Partial<BuildAgentSystemPromptParams> = {},
  disabledTools?: readonly string[],
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
  const agent = builtinAgentRecord(DEFAULT_AGENT_HANDLE)
  const profile = resolveRunProfile(
    { sessionKind: SHAPE_SESSION_KIND[profileKey] },
    agent ? { prompt: agent.instructions } : undefined,
  )
  // Production parity (runtime-tools.ts): a session with active loops keeps `loops`
  // direct — the loops section instructs dynamic loops to call `loops.reschedule`.
  const registry = richRegistry(profile, disabledTools)
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

/**
 * The committed golden matrix: name → rendered prompt. Each entry is a full,
 * deterministic system prompt; reviewing these files IS reviewing the whole picture.
 */
export function renderGoldenMatrix(): Record<string, string> {
  return {
    orchestrator: fullPrompt('orchestrator'),
    subagent: fullPrompt('subagent', {
      // sub-agents have no skill tool → skills section is gated off; keep the rest.
      deliveryContext: undefined,
    }),
    automation: fullPrompt('automation'),
    'orchestrator-channel': fullPrompt('orchestrator', {
      deliveryContext: { channel: 'messenger' },
    }),
    // A NARROWED roster: the sharpest capability test in the product. Every section that
    // names a tool has to disappear with it, or the model is told to call something it cannot
    // see. The list is the one an agent's own rules would produce — there is no second,
    // session-level switch that narrows a run any more.
    'orchestrator-lean': fullPrompt('orchestrator', {}, LEAN_ROSTER_DISABLED),
    // NOTE: background jobs are intentionally NOT rendered here — their section
    // stamps a live age (Date.now()) and would make the golden non-deterministic.
    // Their text is locked by a dedicated section test that passes a fixed `now`.
    // A conversation with a colleague, from the leader's seat: the full turn protocol in the
    // cached prefix, the roster and the directory in the volatile tail.
    'orchestrator-conversation': fullPrompt('orchestrator', CONVERSATION_CONTEXT),
    'orchestrator-volatile-tail': fullPrompt('orchestrator', {
      activeSubAgents: [{ title: 'child-agent', task: 'do thing' }],
      loopContext: {
        loops: [{ id: 'loop-1', kind: 'fixed', cadence: '*/10 * * * *', prompt: 'tick' }],
      },
    }),
  }
}

/**
 * Every prompt the product can actually render, as (profile × narrowed roster).
 *
 * `renderGoldenMatrix` is a curated, COMMITTED set — one file per interesting variant,
 * reviewed by humans. It is deliberately small, and that is exactly why it kept missing
 * capability bugs: an agent's rules narrow the roster independently of the run shape, so a
 * golden keyed on shape alone is blind to it. A prompt that names a tool the rules took away
 * is the exact defect this matrix exists to catch.
 *
 * This matrix is not committed anywhere — it exists so `system-prompt-capability.test.ts`
 * can lint the whole cross-product without a golden file per cell. Add an orthogonal
 * switch that changes the tool set, and it belongs HERE, not in one more golden.
 *
 * All three run shapes are covered; there is no fourth, host-managed one to exclude.
 */
export function renderCapabilityMatrix(): Record<string, string> {
  const out: Record<string, string> = {}
  const rosters: Record<string, readonly string[] | undefined> = {
    '': undefined,
    '-lean': LEAN_ROSTER_DISABLED,
    '-solo': SOLO_ROSTER_DISABLED,
  }
  for (const profileKey of Object.keys(SHAPE_SESSION_KIND) as PromptShapeKey[]) {
    for (const [suffix, disabled] of Object.entries(rosters)) {
      out[`${profileKey}${suffix}`] = fullPrompt(profileKey, {}, disabled)
      // The same cell inside a conversation with a colleague: the sections that name the
      // collaboration tools (turn control, roster, directory) render only here.
      out[`${profileKey}${suffix}-conversation`] = fullPrompt(
        profileKey,
        CONVERSATION_CONTEXT,
        disabled,
      )
    }
  }
  return out
}

/**
 * Merge named prompt matrices for the lints, deduping on TEXT and never on name.
 *
 * The three prompt lints each built their union as `{ ...capability, ...golden }`, which
 * dedupes by KEY — and the goldens are hand-written labels shaped exactly like the derived
 * keys, so colliding pairs silently collapsed and, where they DIFFERED, the golden won. The
 * union shrank from 49 entries to 39 inside the very mechanism that exists because the
 * goldens "kept missing capability bugs".
 *
 * So: identical TEXT collapses (it is the same prompt, however it was reached), and a name
 * collision between two DIFFERENT prompts qualifies the later one instead of dropping it.
 * Earlier sources win the unqualified name, which is why goldens are passed first — their
 * labels are the human-reviewed ones.
 */
export function mergeMatricesByText(
  ...matrices: ReadonlyArray<Record<string, string>>
): Record<string, string> {
  const out: Record<string, string> = {}
  const seenText = new Set<string>()
  for (const matrix of matrices) {
    for (const [name, text] of Object.entries(matrix)) {
      if (seenText.has(text)) continue
      seenText.add(text)
      let key = name
      for (let n = 2; key in out; n += 1) key = `${name} (${n})`
      out[key] = text
    }
  }
  return out
}

/** The union every prompt lint runs over: curated goldens first, then the generated cells. */
export function renderLintMatrix(): Record<string, string> {
  return mergeMatricesByText(renderGoldenMatrix(), renderCapabilityMatrix())
}
