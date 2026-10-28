/**
 * Capability lint: the assembled prompt may never name a tool this run does not have.
 *
 * Every prompt line is a capability claim. A claim the run cannot honour costs the
 * model a wasted turn and teaches it the prompt is unreliable. Two such bugs shipped
 * before this test existed, both invisible in the section builders and obvious in the
 * rendered goldens:
 *
 *   - `automation-auto` was told to "ALWAYS end the run with {action:"complete"}" via
 *     the task-board tool, which only existed for a board-dispatched run;
 *   - a planning orchestrator described task delegation on a run without the (since removed) `agents` tool.
 *
 * The reverse claim is linted too: prose that says the model does NOT have a tool which
 * is sitting right there in its roster (the orchestrator prose used to say "you have no
 * `sleep` tool" while listing `sleep`).
 *
 * `dedup.test.ts` lints cross-section duplication; the golden snapshots
 * lint drift. Neither reads the prompt for coherence. This does.
 */
import { describe, expect, test } from 'bun:test'
import { renderLintMatrix } from './testing/prompt-harness'
import { toolSetsOfPrompt } from './testing/prompt-render'
import { ACTIVATE_TOOLS_TOOL_NAME, TOOL } from '../tool-names'

// The names the model is offered, and so the ones the roster lists and the prose may use.
const TOOL_NAMES = [...Object.values(TOOL), ACTIVATE_TOOLS_TOOL_NAME] as string[]

/** The prompt's prose without the catalog of absences, which names tools the run does NOT hold. */
const proseOf = (prompt: string) => withoutAbsenceCatalog(prompt)

/**
 * A tool is "named" when the prose backticks it, calls one of its actions (`skill.get`), or —
 * for a name no English sentence contains by accident (`conversation_control`,
 * `history_search`) — writes it bare. Backticks alone were the first version, and the turn
 * protocol named `conversation_control` bare in every line, so a run without the tool could
 * be told to call it and pass.
 */
export const names = (prose: string, tool: string) =>
  new RegExp('`' + tool + '`').test(prose) ||
  new RegExp(`\\b${tool}\\.[a-z]`).test(prose) ||
  ((tool.includes('_') || /[a-z][A-Z]/.test(tool)) && new RegExp(`\\b${tool}\\b`).test(prose))

/**
 * "# Unavailable tools" is the one section whose job is to name tools the run does NOT hold,
 * each beside its remedy — the catalog of absences, not a claim of presence.
 */
function withoutAbsenceCatalog(prose: string): string {
  const start = prose.indexOf('# Unavailable tools\n')
  if (start < 0) return prose
  const end = prose.indexOf('\n\n', start)
  return prose.slice(0, start) + (end < 0 ? '' : prose.slice(end))
}

/**
 * Phrases in which the prompt DENIES this agent a tool. Deliberately self-referential:
 * a prompt may legitimately describe a restriction that applies only to another run, which is a
 * true statement about OTHER agents and must not read as a denial about itself.
 *
 * A denial is the one context where naming an absent tool is correct — "there is no
 * task-delegation tool here" is exactly what an orchestrator whose run lacks it should be
 * told.
 */
const DENIALS = [
  (t: string) => `no \`${t}\` tool`,
  (t: string) => `you have no \`${t}\``,
  (t: string) => `\`${t}\` is not available`,
]

const denies = (prose: string, tool: string) =>
  DENIALS.some((phrase) => prose.includes(phrase(tool)))

/**
 * Every tool the prose tells the model to CALL with an action. `names` only knows the catalog's
 * names, so a call to a tool that exists nowhere passed it: the sub-agent roster told every chat
 * to use `fork` action:"list", a tool renamed to `Agent` long before.
 */
export const calledTools = (prose: string) =>
  [...prose.matchAll(/`([A-Za-z][A-Za-z0-9_]*)` action:/g)].map((match) => match[1]!)

// The committed goldens PLUS every (profile × tool-surface) cell the product can render.
// The goldens alone were structurally blind to surfaces nobody committed a file for, and
// two shipped capability bugs hid in exactly that gap. Deduped: a golden and a generated
// cell may render the same prompt.
const MATRIX = Object.entries(renderLintMatrix())

describe('system-prompt capability lint', () => {
  test('the detector sees every way a prompt names a tool (positive control)', () => {
    expect(names('call `history_search` first', 'history_search')).toBe(true)
    expect(names('call history_search first', 'history_search')).toBe(true)
    expect(names('retrieve it (skill.get)', 'skill')).toBe(true)
    // A common word is only a tool when it is marked as one.
    expect(names('read the file and search it', 'read')).toBe(false)
    const prose = proseOf('# Unavailable tools\n- vault — off\n\n# Other\nUse vault_x.')
    expect(prose).not.toContain('vault — off')
    expect(calledTools('Use `fork` action:"list" for your forks.')).toEqual(['fork'])
    expect(calledTools('Use `fork` to split work.')).toEqual([])
  })

  test('the golden matrix is non-empty and every variant knows the tools it was built for', () => {
    expect(MATRIX.length).toBeGreaterThan(0)
    for (const [variant, prompt] of MATRIX) {
      expect(`${variant}: ${toolSetsOfPrompt(prompt).length > 0}`).toBe(`${variant}: true`)
    }
  })

  for (const [variant, prompt] of MATRIX) {
    const prose = proseOf(prompt)
    const rosters = toolSetsOfPrompt(prompt)

    test(`${variant}: names no tool it does not have`, () => {
      const phantom = TOOL_NAMES.filter(
        (t) => rosters.some((roster) => !roster.has(t)) && names(prose, t) && !denies(prose, t),
      )
      expect(`${variant} names absent tools: ${phantom.join(', ')}`).toBe(
        `${variant} names absent tools: `,
      )
    })

    test(`${variant}: calls only tools it holds`, () => {
      const phantom = calledTools(prose).filter((tool) =>
        rosters.some((roster) => !roster.has(tool)),
      )
      expect(`${variant} calls absent tools: ${phantom.join(', ')}`).toBe(
        `${variant} calls absent tools: `,
      )
    })

    test(`${variant}: never denies a tool that it holds`, () => {
      const lies = TOOL_NAMES.filter(
        (t) => rosters.every((roster) => roster.has(t)) && denies(prose, t),
      )
      expect(`${variant} denies present tools: ${lies.join(', ')}`).toBe(
        `${variant} denies present tools: `,
      )
    })
  }
})
