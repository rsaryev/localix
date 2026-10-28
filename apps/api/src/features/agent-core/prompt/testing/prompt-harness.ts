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
 * One render is `prompt-render.ts`; the production runs are `prompt-scenarios.ts`.
 */
import { TOOL } from '../../tool-names'
import type { BuildAgentSystemPromptParams } from '../assemble'
import type { OptionalToolPorts } from '../../tool-registry'
import { fullPrompt, SHAPE_SESSION_KIND, type PromptShapeKey } from './prompt-render'
import { renderHostMatrix } from './prompt-scenarios'

/**
 * A NARROWED roster, standing in for what an agent's own capability rules produce.
 *
 * Not a product list — there is no second, session-level switch that trims a run any more. It
 * is a representative set of optional tools an agent might not be given, so the lints can prove
 * every section that names one disappears with it.
 */
const LEAN_ROSTER_DISABLED: readonly string[] = [
  TOOL.GlobalSearch,
  TOOL.Vault,
  TOOL.Skill,
  TOOL.Jobs,
  TOOL.Browser,
]

/** A conversation with the person, with the agents `Agent` can start beside it. */
const CONVERSATION_CONTEXT: Partial<BuildAgentSystemPromptParams> = {
  conversation: true,
  agentDirectory: [{ id: 'agent-qa', name: 'qa', description: 'Verifies releases' }],
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
    // A conversation with the person: the turn contract in the cached prefix, the directory in
    // the volatile tail.
    'orchestrator-conversation': fullPrompt('orchestrator', CONVERSATION_CONTEXT),
    'orchestrator-volatile-tail': fullPrompt('orchestrator', {
      activeSubAgents: [{ title: 'child-agent', task: 'do thing' }],
      loopContext: {
        loops: [{ id: 'loop-1', kind: 'fixed', cadence: '*/10 * * * *', prompt: 'tick' }],
      },
    }),
    // The runs a host actually builds (`prompt-scenarios.ts`): every production run carries
    // its conversation, which the shape goldens above leave out.
    ...renderHostMatrix(),
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
 * This matrix is not committed anywhere — it exists so `capability.test.ts`
 * can lint the whole cross-product without a golden file per cell. Add an orthogonal
 * switch that changes the tool set, and it belongs HERE, not in one more golden.
 *
 * All three run shapes are covered; there is no fourth, host-managed one to exclude.
 */
export function renderCapabilityMatrix(): Record<string, string> {
  const out: Record<string, string> = {}
  const rosters: Record<
    string,
    { disabled?: readonly string[]; withoutPorts?: readonly (keyof OptionalToolPorts)[] }
  > = {
    '': {},
    '-lean': { disabled: LEAN_ROSTER_DISABLED },
  }
  for (const profileKey of Object.keys(SHAPE_SESSION_KIND) as PromptShapeKey[]) {
    for (const [suffix, { disabled, withoutPorts }] of Object.entries(rosters)) {
      out[`${profileKey}${suffix}`] = fullPrompt(profileKey, {}, disabled, withoutPorts)
      // The same cell inside a conversation: the sections that name the collaboration tools
      // (turn control, directory) render only here.
      out[`${profileKey}${suffix}-conversation`] = fullPrompt(
        profileKey,
        CONVERSATION_CONTEXT,
        disabled,
        withoutPorts,
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
