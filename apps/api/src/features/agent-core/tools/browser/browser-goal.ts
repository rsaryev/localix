/**
 * `goal` — the decision model drives the current tab toward a short sub-goal the agent states:
 * snapshot → one decision request → one action → repeat, bounded. Shaped after jev-ultrafast's
 * loop (`agent.py`): structured state, no screenshots, one request per step, every executed
 * target an observed ref.
 *
 * It never decides success. It stops on the model's DONE or BLOCKED, a decision without answers,
 * a relay failure, the step cap, the same action twice without a visible change, or the same page state a third time, and returns
 * the trace and the FINAL page snapshot — the agent reads the page and judges the result, as the
 * prompt's verification rule asks of every browser action.
 */
import type { AgentToolResult } from '@localixai/agent/agents'
import type { DecisionAsk, DecisionOutcome } from '@localixai/mini-app-sdk/backend'

import type {
  PreviewCommand,
  PreviewSendOutcome,
  PreviewSnapshot,
  PreviewStep,
} from '../preview/preview-control'
import { snapshotContent } from './browser-format'
import { budgetReport, repairAsk, type BudgetDecide } from './browser-goal-report'
import {
  describeElement,
  goalAsk,
  pageText,
  readGoal,
  traceLine,
  type GoalOperation,
  type GoalStep,
} from './browser-goal-ask'

/** Actions one goal may execute, and decision requests it may make. */
export const GOAL_MAX_ACTIONS = 20
/** Below this probability a DONE is reported as unsure. */
export const GOAL_DONE_CONFIDENCE = 0.6
export const GOAL_MAX_DECISIONS = 40
const BUDGET_STOP = `the ${GOAL_MAX_ACTIONS}-action limit`
/** Fields whose typing brings up options to pick, and how long their options may take. */
const SUGGESTING_ROLES = new Set(['combobox', 'searchbox'])
const SUGGESTION_WAIT_MS = 150
/** How long a WAIT holds before the next look. */
export const GOAL_WAIT_MS = 300

export interface GoalDeps {
  send(command: PreviewCommand): Promise<PreviewSendOutcome>
  /** The decision model for this run; absent when the host has none. */
  decide?: (ask: DecisionAsk, options: { signal?: AbortSignal }) => Promise<DecisionOutcome>
  /** The exposure shield: every request to the decision model passes through it. */
  redact?: (value: unknown) => unknown
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>
}

export interface GoalInput {
  goal: string
  values: readonly string[]
  previewId?: string
  signal?: AbortSignal
  /** Called after each step with the whole trace so far, so the person sees the run live. */
  onProgress?: (lines: string[]) => void
}

export const NO_DECISION_MODEL =
  'action="goal" needs a decision model, and none is connected (connect OpenRouter). Drive the page with action="steps" instead.'
export const NO_ELEMENTS =
  'action="goal" needs the page’s element list, which this tab’s probe does not send. Drive the page with action="steps" instead.'

type Result = AgentToolResult<{ action: 'goal'; error?: string }>

const STEP_OF: Partial<Record<GoalOperation, (ref?: string, value?: string) => PreviewStep>> = {
  CLICK: (ref) => ({ action: 'click', ref }),
  TYPE_TEXT: (ref, value) => ({ action: 'type', ref, text: value }),
  PRESS_ENTER: () => ({ action: 'press', key: 'Enter' }),
  SCROLL_DOWN: () => ({ action: 'scroll', direction: 'down' }),
  SCROLL_UP: () => ({ action: 'scroll', direction: 'up' }),
}

/** A state seen this often is a loop: the third return to it ends the run. */
export const GOAL_STATE_RETURNS = 3

/** What the person would call "the same page": address, visible words, controls and their values. */
const fingerprint = (snapshot: PreviewSnapshot) =>
  [snapshot.url, pageText(snapshot.tree), ...(snapshot.elements ?? []).map(describeElement)].join(
    '\n',
  )

const sameAction = (a: GoalStep | undefined, b: GoalStep) =>
  !!a && a.operation === b.operation && a.ref === b.ref && a.value === b.value

export async function runGoal(deps: GoalDeps, input: GoalInput): Promise<Result> {
  const rawDecide = deps.decide
  if (!rawDecide) return { content: NO_DECISION_MODEL, isError: true }
  // The page's fields and text may echo a typed secret; the provider only sees the shielded ask.
  const { redact } = deps
  const decide: typeof rawDecide = (ask, options) =>
    rawDecide(redact ? (redact(ask) as DecisionAsk) : ask, options)
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
  const tab = input.previewId ? { previewId: input.previewId } : {}
  const history: GoalStep[] = []
  let stopped = BUDGET_STOP
  let model: string | undefined
  // The page as the last action left it: each action asks for its snapshot in the same relay
  // round trip, so a step costs one browser call and one decision, not two calls.
  let latest: PreviewSnapshot | undefined
  let retriedStale = false
  let undecodable = false
  // The next read is the same visit as the last one (a stale target was looked at again).
  let rereading = false
  const seen = new Map<string, number>()

  for (let decisions = 0; decisions < GOAL_MAX_DECISIONS; decisions++) {
    if (input.signal?.aborted) {
      stopped = 'cancelled'
      break
    }
    if (history.filter((step) => step.operation !== 'WAIT').length >= GOAL_MAX_ACTIONS) break
    let snapshot = latest?.elements ? latest : undefined
    if (!snapshot) {
      const looked = await deps.send({ action: 'snapshot', ...tab })
      if ('error' in looked) return finish(`the page could not be read: ${looked.error}`)
      snapshot = looked.result.snapshot
    }
    if (!snapshot?.elements) return { content: NO_ELEMENTS, isError: true }
    latest = snapshot
    // A WAIT looks at the same page on purpose; any other way back to a state is a loop.
    if (history.at(-1)?.operation !== 'WAIT' && !rereading) {
      const state = fingerprint(snapshot)
      const count = (seen.get(state) ?? 0) + 1
      seen.set(state, count)
      if (count >= GOAL_STATE_RETURNS) {
        stopped = 'the same page state came back a third time'
        break
      }
    }
    rereading = false
    const ask = goalAsk({
      goal: input.goal,
      page: { url: snapshot.url, title: snapshot.title, text: pageText(snapshot.tree) },
      elements: snapshot.elements,
      values: input.values,
      history,
    })
    const outcome = await decide(ask, { signal: input.signal })
    if (outcome.status !== 'answered') {
      stopped = `the decision model did not answer (${outcome.status})`
      break
    }
    model = outcome.model
    let pick = readGoal(outcome.answers, ask, input.values)
    // An answer that does not decode, or names an operation not offered, gets ONE follow-up that
    // names the error and the allowed operations. A second failure is a definitive error: the
    // model is not understood, which a retry of the whole run would not change.
    if ('error' in pick) {
      const again = await decide(repairAsk(ask, pick.error), { signal: input.signal })
      if (again.status !== 'answered') {
        stopped = `the decision model did not answer the repair (${again.status})`
        break
      }
      pick = readGoal(again.answers, ask, input.values)
      if ('error' in pick) {
        undecodable = true
        stopped = `${pick.error} It was asked once more with the error and the allowed operations, and still failed.`
        break
      }
    }
    const element = snapshot.elements.find((candidate) => candidate.ref === pick.ref)
    const step: GoalStep = {
      ...pick,
      ...(element ? { element: describeElement(element) } : {}),
    }
    if (pick.operation === 'DONE' || pick.operation === 'BLOCKED') {
      history.push(step)
      progress()
      // Confidence is a second axis (TypeSafe's confidence-gated routing): a DONE the model barely
      // prefers is reported as a doubt, so the agent knows the page needs a hard look.
      stopped =
        pick.operation === 'BLOCKED'
          ? 'the model is blocked'
          : pick.probability < GOAL_DONE_CONFIDENCE
            ? `the model said done but was unsure (${Math.round(pick.probability * 100)}%) — something may be missing`
            : 'the model judged the goal done'
      break
    }
    if (pick.operation === 'WAIT') {
      history.push(step)
      progress()
      await sleep(GOAL_WAIT_MS)
      latest = undefined
      continue
    }
    const repeated = sameAction(history.at(-1), step) && history.at(-1)?.changed === false
    const acted = await deps.send({
      action: 'steps',
      ...tab,
      steps: [STEP_OF[pick.operation]!(pick.ref, pick.value)],
      snapshotAfter: true,
    })
    if ('error' in acted) {
      latest = undefined
      // A target gone since the snapshot (a popup that was still opening) is a stale read, not a
      // failed action: look again and decide again, once per step.
      if (acted.errorCode === 'not_found' && !retriedStale) {
        retriedStale = true
        rereading = true
        continue
      }
      history.push({ ...step, changed: false, failed: true })
      progress()
      stopped = `the action failed: ${acted.error}`
      break
    }
    retriedStale = false
    const after = acted.result.snapshot
    // A fresh snapshot replaces the diff: the page changed when its address or its tree did.
    const changed =
      !!acted.result.reloaded ||
      !!acted.result.diff?.trim() ||
      (!!after &&
        (after.url !== snapshot.url ||
          after.tree !== snapshot.tree ||
          JSON.stringify(after.elements) !== JSON.stringify(snapshot.elements)))
    latest = after
    // Typing into a field that suggests (a combobox, a search box) shows its options a moment
    // later; deciding on the snapshot from before they arrive wastes a step or reads stale refs.
    // jev-ultrafast waits for them too, capped at 200 ms.
    if (
      pick.operation === 'TYPE_TEXT' &&
      element &&
      SUGGESTING_ROLES.has(element.role) &&
      !after?.elements?.some((candidate) => candidate.role === 'option')
    ) {
      await sleep(SUGGESTION_WAIT_MS)
      latest = undefined
    }
    history.push({ ...step, changed })
    progress()
    if (repeated && !changed) {
      stopped = 'the same action twice without a visible change'
      break
    }
  }
  if (stopped === BUDGET_STOP && !input.signal?.aborted) stopped = await report(decide, stopped)
  return finish(stopped)

  /**
   * The budget is spent: one last turn that may only report. Its verdict joins the stop reason;
   * a model that cannot give one leaves the reason as it was.
   */
  async function report(ask: BudgetDecide, reason: string): Promise<string> {
    const looked = latest?.elements ? undefined : await deps.send({ action: 'snapshot', ...tab })
    const snapshot = looked ? ('error' in looked ? undefined : looked.result.snapshot) : latest
    if (!snapshot?.elements) return reason
    latest = snapshot
    const verdict = await budgetReport(
      ask,
      {
        goal: input.goal,
        page: { url: snapshot.url, title: snapshot.title, text: pageText(snapshot.tree) },
        elements: snapshot.elements,
        values: input.values,
        history,
      },
      input.signal,
    )
    return verdict ? `${reason}; final report from the evidence in view: ${verdict}` : reason
  }

  function progress() {
    input.onProgress?.(history.map((step, i) => `${i + 1}. ${traceLine(step)}`))
  }

  /** The trace and the page as it is now, for the agent to judge. */
  async function finish(reason: string): Promise<Result> {
    // The page the last step read or left, when there is one; else read it now.
    const final = latest
      ? { result: { action: 'snapshot' as const, snapshot: latest } }
      : await deps.send({ action: 'snapshot', ...tab })
    const lines = history.map((step, i) => `${i + 1}. ${traceLine(step)}`)
    const header = `Goal: ${input.goal}\nThe decision model${model ? ` (${model})` : ''} took ${history.length} ${history.length === 1 ? 'step' : 'steps'}; stopped: ${reason}.`
    const typed = new Set(
      history.filter((step) => step.operation === 'TYPE_TEXT' && !step.failed).map((s) => s.value),
    )
    const unused = input.values.filter((value) => !typed.has(value))
    if (unused.length)
      lines.push(`Values never typed: ${unused.map((value) => JSON.stringify(value)).join(', ')}`)
    // Without values the decision model is offered no typing at all: a goal that needed a field
    // filled can only click and scroll until it loops, which reads like a page that resists.
    if (!input.values.length && history.at(-1)?.operation !== 'DONE')
      lines.push(
        'No values were given, so the decision model could click and scroll but not type: a field to fill needs its text in values (values: ["the text"]).',
      )
    const page =
      'error' in final
        ? `The final page could not be read: ${final.error}`
        : `Check the page yourself — DONE is not proof:\n\n${snapshotContent(final.result)}`
    return {
      content: [header, ...lines, '', page].join('\n'),
      details: { action: 'goal' },
      ...(undecodable ? { isError: true } : {}),
      supersedeKey: 'browser',
    }
  }
}
