/**
 * `plan` — the agent's side of the conversation's plan, ONE tool whose `action` says what it does:
 *
 *   present   hand the person the draft file as a version to review, and stop (plan mode only);
 *   read      where the plan's files are and what state each version is in — so an agent past a
 *             context checkpoint finds what it agreed to and reads it with `read`;
 *   complete  declare the approved plan done, with a short report (only once one is approved).
 *
 * One tool rather than three, because the lifecycle is one object and the gating is about its
 * STATE, not about which tool the roster happens to hold. The previous shape made `plan` a tool
 * that existed only in plan mode: the moment an approval switched the mode, the tool left the
 * roster — so the implementing agent had no way to say the work was finished. Now the tool is
 * always there and each action checks the state it needs, answering a clear error when it does
 * not hold.
 *
 * The plan is a FILE (`plans/plan-paths.ts`). When it lived only in `present`'s argument, every
 * change meant retyping the whole plan, and a version the person had set aside could only come
 * back re-typed as a new number. The agent now writes `PLAN.md` with its ordinary
 * file tools and `present` snapshots it; presenting text the latest version already has answers
 * with that version instead of storing a copy (`plans/presentation.ts`).
 *
 * `present` ENDS the turn: the next step is the person's, and a model that kept going would start
 * implementing what it just asked approval for. `complete` does not — the agent reports in its
 * reply what it finished.
 *
 * The schema is ONE object with per-action checks rather than a discriminated union: a union
 * root has no `type: "object"`, and OpenAI-family providers reject the whole request for it
 * (`tool-description-schema.test.ts`).
 */
import { z } from 'zod'
import { defineAgentTool } from '@localixai/agent/agents'

import { TOOL } from '../../tool-names'
import type {
  PlanOverview,
  PlanPresentation,
  PresentInput,
  SessionPlan,
} from '../../../plans/contracts'
import { PLAN_BODY_MAX, PLAN_SUMMARY_MAX, PLAN_TITLE_MAX } from '../../plan-limits'
import { classifyPlanCall, PLAN_ACTIONS } from './plan-call-class'

export interface PlanToolOptions {
  /** Whether the conversation (its ROOT) is in plan mode right now. */
  inPlanMode: () => Promise<boolean>
  /** Present the draft (written from `body` first when given). Throws a message for the model. */
  present: (input: PresentInput) => Promise<PlanPresentation>
  /** Every version and the draft's state. */
  overview: () => Promise<PlanOverview>
  /** The approved version is done. Throws when there is no approved version. */
  complete: (summary: string) => Promise<SessionPlan>
}

export interface PlanToolDetails {
  /** The version the call acted on, or the one in play for `read`. */
  plan: SessionPlan | null
  /** `present` only: whether it stored a new version, restored one, or found it waiting. */
  outcome?: PlanPresentation['outcome']
}

const inputSchema = z
  .object({
    action: z
      .enum(PLAN_ACTIONS)
      .describe(
        '"present" — show the user the plan file as a version to review (plan mode only; ends ' +
          'your turn). "read" — where the plan files are and each version\'s status. ' +
          '"complete" — the approved plan is done; give a short summary.',
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(PLAN_TITLE_MAX)
      .optional()
      .describe("present: short name; defaults to the file's first # heading."),
    body: z
      .string()
      .trim()
      .min(1)
      .max(PLAN_BODY_MAX)
      .optional()
      .describe(
        'present: a FIRST draft in markdown, written to the plan file for you. Omit it to present ' +
          'the file as it is — change the file with edit, never by retyping it here.',
      ),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(PLAN_SUMMARY_MAX)
      .optional()
      .describe('complete (required): what was done, first line first; name anything undone.'),
  })
  .superRefine((input, ctx) => {
    if (input.action === 'complete' && !input.summary)
      ctx.addIssue({ code: 'custom', path: ['summary'], message: 'complete needs `summary`.' })
    if (input.action !== 'present' && (input.title !== undefined || input.body !== undefined))
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'title/body are for present.' })
    if (input.action !== 'complete' && input.summary !== undefined)
      ctx.addIssue({ code: 'custom', path: ['summary'], message: 'summary is for complete.' })
  })

type Input = z.infer<typeof inputSchema>

const failure = (content: string) => ({ content, isError: true as const })
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const PRESENTED: Record<PlanPresentation['outcome'], (plan: SessionPlan) => string> = {
  presented: (plan) => `Plan v${plan.version} is with the user for review.`,
  restored: (plan) => `Plan v${plan.version} is back with the user for review (same version).`,
  unchanged: (plan) =>
    `v${plan.version} is already with the user — the plan file has not changed since.`,
}

/** The version in play: the approved one being implemented, else the one under review. */
const inPlay = (plans: readonly SessionPlan[]) =>
  plans.find((plan) => plan.status === 'approved') ??
  plans.find((plan) => plan.status === 'presented') ??
  null

function describeOverview({ plans, draft }: PlanOverview): string {
  const latest = plans[0]
  const draftState = !draft.exists
    ? 'not written yet'
    : draft.changed
      ? `changed since v${latest?.version ?? 0}; not presented yet`
      : latest
        ? `same text as v${latest.version}`
        : 'empty'
  const current = inPlay(plans)
  return [
    `Plan file: ${draft.path} (${draftState})`,
    ...(current ? [`In play: v${current.version} (${current.status}) — ${current.filePath}`] : []),
    plans.length ? 'Versions, newest first:' : 'No version has been presented yet.',
    ...plans.map((plan) => `- v${plan.version} ${plan.status}: ${plan.title} — ${plan.filePath}`),
    plans.length ? "Read a version's text with `read` on its path." : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function createPlanTool(options: PlanToolOptions) {
  const run = {
    async present(input: Input) {
      if (!(await options.inPlanMode()))
        return failure(
          'The conversation is not in Plan mode; the user switches modes. Continue the work instead.',
        )
      const presented = await options
        .present({
          ...(input.title ? { title: input.title } : {}),
          ...(input.body ? { body: input.body } : {}),
        })
        .catch((error: unknown) => messageOf(error))
      if (typeof presented === 'string') return failure(presented)
      const { outcome, plan } = presented
      return {
        content:
          `${PRESENTED[outcome](plan)} Stop here and wait: their comments or approval arrive as ` +
          'your next turn. Do not start implementing.',
        details: { plan, outcome },
        terminate: true,
      }
    },

    async read() {
      const overview = await options.overview()
      return { content: describeOverview(overview), details: { plan: inPlay(overview.plans) } }
    },

    async complete(input: Input) {
      if (!input.summary) return failure('complete needs `summary`: what was done.')
      const approved = inPlay((await options.overview()).plans)
      if (approved?.status !== 'approved')
        return failure(
          'There is no approved plan to complete. `complete` is for an approved plan whose work is done.',
        )
      const plan = await options.complete(input.summary)
      return {
        content: `Plan v${plan.version} is marked completed. Tell the user what was done.`,
        details: { plan },
      }
    },
  }

  return defineAgentTool<Input, PlanToolDetails>({
    name: TOOL.plan,
    label: 'Plan',
    activeVerb: 'Working on plan',
    description: [
      "The conversation's plan. In plan mode, write the plan (goal, approach, steps, risks, open",
      'questions) to the plan file named in your instructions, then `present` it for the user to',
      'comment on, revise or approve — it ends your turn. Revise the file, then present again;',
      'presenting unchanged text re-shows the same version instead of a new one. `read` lists',
      'the plan files and versions. Once the approved work is done, `complete` closes the plan',
      'with a short summary. Not a progress tracker.',
    ].join(' '),
    inputSchema,
    executionMode: 'sequential',
    mutates: true,
    classify: classifyPlanCall,
    async execute(_toolCallId, input) {
      // `hasOwn`: an action outside the enum (a schema that let it through) is an error, never a
      // prototype method.
      if (!Object.hasOwn(run, input.action))
        return failure(`Unknown plan action "${String(input.action)}".`)
      return run[input.action](input)
    },
  })
}
