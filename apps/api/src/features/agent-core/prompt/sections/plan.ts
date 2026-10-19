/**
 * The two plan sections of the cached prefix.
 *
 * `# Plan mode` — what a plan-mode run is for. Rendered only for a run admitted in plan mode that
 * holds `plan`: the tool now lives in every mode (an implementing run needs `complete`), so the
 * roster alone no longer says which mode this is, and the run passes it. Each tool the section
 * names is gated on the registry: the old plan prompt told runs to call tools they lacked.
 *
 * `# Approved plan` — the version the person approved, for every later run of the conversation.
 * It lives in the system prompt, not in history, because a context checkpoint folds old turns
 * into cards: the plan the agent is implementing must survive the checkpoint that would
 * otherwise reduce it to a one-line summary. It changes when the person decides, never mid-turn,
 * so it belongs in the cached prefix.
 */
import { TOOL } from '../../tool-names'

export const PLAN_MODE_HEADER = '# Plan mode'
export const APPROVED_PLAN_HEADER = '# Approved plan'

export interface ApprovedPlanPrompt {
  version: number
  title: string
  body: string
  /** The version's snapshot file (`plans/plan-paths.ts`), when the host knows it. */
  path?: string
}

/**
 * `planMode` is set when the run was admitted in plan mode; `draftPath` is the conversation's
 * plan file. Naming the file is what lets the agent change a plan with an edit: a plan known only
 * as `present`'s argument was retyped whole on every revision, and a version set aside was
 * re-typed as a new one — the section says to present an unchanged file instead.
 */
export function buildPlanModeSection(
  hasTool: (name: string) => boolean,
  planMode: { draftPath?: string } | undefined,
): string | undefined {
  if (!planMode) return undefined
  const clarify = hasTool(TOOL.ask) ? ' Ask clarifying questions with `ask` when needed.' : ''
  // A delegated run is born into its conversation's plan mode but never holds `plan` (chat-only).
  // Rendering nothing left it to learn the mode from its first refused write — whose text then
  // pointed it at a tool it did not have. It is told what it is for instead: read and report.
  if (!hasTool(TOOL.plan)) {
    return [
      PLAN_MODE_HEADER,
      'This conversation is in plan mode: investigate read-only and report what you find to the ' +
        'agent that delegated this work. Changes to files, the host or anything outside this ' +
        'conversation are refused in this mode.',
    ].join('\n')
  }
  const draft = planMode.draftPath
    ? [
        `Write the plan to ${planMode.draftPath} — the only file you may change in this mode. ` +
          `Revise it with ${editTools(hasTool)} rather than rewriting it whole, then call \`plan\` ` +
          'action `present` without a body. To show an unchanged plan again, just present it: ' +
          'the same text re-shows the same version.',
      ]
    : []
  return [
    PLAN_MODE_HEADER,
    `This conversation is in plan mode: investigate read-only.${clarify} Then present the plan ` +
      'with `plan` action `present`; do not implement anything until the user approves it. ' +
      'Changes to files, the host or anything outside this conversation are refused in this mode.',
    ...draft,
  ].join('\n')
}

/** The edit tools the run holds, named — the section never names a tool the run lacks. */
const editTools = (hasTool: (name: string) => boolean): string => {
  const held = [TOOL.edit].filter((name) => hasTool(name))
  return held.length ? held.map((name) => `\`${name}\``).join(' or ') : 'small edits'
}

/**
 * Markdown headings in the body are demoted one level. The body sits inside the cached prefix,
 * where a `# ` line reads as a section of the prompt — to the model, and to every check that
 * walks the prompt by its headers (a body line `# Runtime context` would pose as the boundary).
 */
const demoteHeadings = (body: string) => body.replace(/^(#{1,5}) /gmu, '#$1 ')

export function buildApprovedPlanSection(
  plan: ApprovedPlanPrompt | undefined,
  hasTool: (name: string) => boolean,
): string | undefined {
  if (!plan?.body.trim()) return undefined
  const complete = hasTool(TOOL.plan)
    ? ' When the approved work is done, call `plan` with action `complete` and a short summary. ' +
      '`complete` is for done: if only part is done, say so plainly instead of completing it.'
    : ''
  return [
    APPROVED_PLAN_HEADER,
    `The user approved plan v${plan.version} (${JSON.stringify(plan.title)})` +
      `${plan.path ? `, saved as ${plan.path}` : ''}. Follow it; where ` +
      `the work shows it is wrong, say so rather than silently diverging.${complete}`,
    `<approved-plan version="${plan.version}">`,
    demoteHeadings(plan.body.trim()),
    '</approved-plan>',
  ].join('\n')
}
