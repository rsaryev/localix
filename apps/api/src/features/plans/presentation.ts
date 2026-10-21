/**
 * WHAT A `present` OF THE DRAFT MEANS, decided against the latest version — pure, no IO.
 *
 * The defect: every `present` became a new version. A person who left Plan mode and came back
 * could not get the version they had been reviewing, so the agent re-typed it, verbatim, as the
 * next number (one session: v4 was v2, 1308 identical characters). Identical text is the SAME
 * plan, so it is answered by what already exists:
 *
 *   latest presented             nothing to store: it is already with the person;
 *   latest dismissed/superseded  bring THAT version back to review, under its own number;
 *   latest approved/completed    refuse: the person decided on exactly this text already;
 *   anything else                a new version.
 *
 * "Identical" ignores whitespace layout — a re-wrapped paragraph or a trailing newline is not a
 * revision a reviewer could see.
 */
import { ConflictError } from '../../lib/domain-errors'
import { PLAN_TITLE_MAX, type PlanRecord } from './contracts'

export type PresentDecision =
  | { kind: 'new' }
  | { kind: 'unchanged'; plan: PlanRecord }
  | { kind: 'restore'; plan: PlanRecord }

const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim()

/** Whether two plan texts say the same thing, whitespace layout aside. */
export const samePlanText = (a: string, b: string): boolean => normalize(a) === normalize(b)

export function decidePresentation(draft: string, latest: PlanRecord | undefined): PresentDecision {
  if (!latest || !samePlanText(draft, latest.body)) return { kind: 'new' }
  switch (latest.status) {
    case 'presented':
      return { kind: 'unchanged', plan: latest }
    case 'dismissed':
    case 'superseded':
      return { kind: 'restore', plan: latest }
    case 'approved':
    case 'completed':
      throw new ConflictError(
        'plan_already_decided',
        `Plan v${latest.version} with this text is already ${latest.status}; edit PLAN.md to ` +
          'propose a change.',
      )
  }
}

/** The draft's first `# ` heading — what a plan file is usually titled by. */
export function headingTitle(draft: string): string | undefined {
  const match = /^#[ \t]+(.+?)[ \t#]*$/mu.exec(draft)
  const title = match?.[1]?.trim()
  return title ? title.slice(0, PLAN_TITLE_MAX) : undefined
}

/** A new version's title: the one given, else the draft's heading, else the previous version's. */
export function versionTitle(
  given: string | undefined,
  draft: string,
  latest: PlanRecord | undefined,
): string {
  return given?.trim() || headingTitle(draft) || latest?.title || 'Plan'
}
