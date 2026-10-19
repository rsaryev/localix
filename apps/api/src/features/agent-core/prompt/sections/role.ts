import type { RunProfile } from '../../run-shape'
import { TOOL } from '../../tool-names'

/**
 * The "# Runtime role" section: how the run's ROLE (orchestrator / subagent / automation) tells
 * it to work.
 *
 * The shape's framing is static (`run-shape-surfaces.ts`); the line that says HOW to do the work
 * is derived from the tools this run actually holds. A role line that names read/bash/edit to a
 * run without them is prose for tools it does not have — the model then claims inspections and
 * edits it cannot perform. So the capability line is computed here, where the roster is known,
 * and the static framing never names a tool (`run-shape.test.ts` pins that).
 *
 * A child buys exactly one thing: context isolation. That criterion — not a count and not an
 * invitation — is what bounds delegation; it is stated once, in "# Execution discipline" and
 * "# Collaboration", and the runtime caps stay a backstop (see `delegation-budget.ts`).
 */

const WORKSPACE_TOOLS = [TOOL.read, TOOL.search, TOOL.bash, TOOL.write, TOOL.edit]

function capabilityLine(shape: RunProfile['shape'], toolNames: readonly string[]): string | null {
  const held = WORKSPACE_TOOLS.filter((name) => toolNames.includes(name)).length
  if (shape === 'chat')
    return 'Do focused work directly with the capabilities listed for this run; do not claim unavailable inspection, mutation, or verification actions.'
  if (shape === 'automation')
    return held > 0
      ? 'Complete exactly the task you were given using only the capabilities listed for this run.'
      : 'Complete exactly the task you were given from the supplied context; do not claim unavailable workspace actions.'
  return null
}

export function buildRoleSection(
  profile: RunProfile,
  toolNames: readonly string[] = WORKSPACE_TOOLS,
): string | null {
  const capability = capabilityLine(profile.shape, toolNames)
  const lines = capability ? [capability] : []
  // An orchestrator is told how to work before its framing; an unattended run is told FIRST that
  // nobody is watching, because every line after it is read in that light.
  const guidance =
    profile.shape === 'automation'
      ? [...profile.prompt.roleGuidance, ...lines]
      : [...lines, ...profile.prompt.roleGuidance]
  if (guidance.length === 0) return null
  return [
    '# Runtime role',
    `Role: ${ROLE_WORD[profile.shape]}`,
    ...guidance.map((line) => `- ${line}`),
  ].join('\n')
}

/**
 * The model-facing word for a run shape.
 *
 * `chat` is the HOST's name for the shape (the session kind it comes from). It is not
 * "orchestrator": every agent in a conversation runs this shape, and only the one with the
 * highest priority leads it.
 */
const ROLE_WORD: Record<RunProfile['shape'], string> = {
  chat: 'conversation agent',
  subagent: 'subagent',
  automation: 'automation',
}
