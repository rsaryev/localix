/**
 * `goal` — the decision model drives the current tab toward a short sub-goal the agent states:
 * snapshot → one decision request → one action → repeat, bounded. Shaped after jev-ultrafast's
 * loop (`agent.py`): structured state, no screenshots, one request per step, every executed
 * target an observed ref.
 *
 * It never decides success. It stops on the model's DONE or BLOCKED, a decision without answers,
 * a relay failure, the step cap, or the same action twice without a visible change, and returns
 * the trace and the FINAL page snapshot — the agent reads the page and judges the result, as the
 * prompt's verification rule asks of every browser action.
 */
import type { AgentToolResult } from '@localixai/agent/agents'
import type { DecisionAsk, DecisionOutcome } from '@localixai/plugin-sdk/backend'

import type {
  PreviewCommand,
  PreviewSendOutcome,
  PreviewSnapshot,
  PreviewStep,
} from '../preview/preview-control'
import { snapshotContent } from './browser-format'
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
/** Fields whose typing brings up options to pick, and how long their options may take. */
const SUGGESTING_ROLES = new Set(['combobox', 'searchbox'])
const SUGGESTION_WAIT_MS = 150
/** How long a WAIT holds before the next look. */
export const GOAL_WAIT_MS = 300

export interface GoalDeps {
  send(command: PreviewCommand): Promise<PreviewSendOutcome>
  /** The decision model for this run; absent when the host has none. */
  decide?: (ask: DecisionAsk, options: { signal?: AbortSignal }) => Promise<DecisionOutcome>
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>
}

export interface GoalInput {
  goal: string
  values: readonly string[]
  previewId?: string
  signal?: AbortSignal
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

const sameAction = (a: GoalStep | undefined, b: GoalStep) =>
  !!a && a.operation === b.operation && a.ref === b.ref && a.value === b.value

export async function runGoal(deps: GoalDeps, input: GoalInput): Promise<Result> {
  if (!deps.decide) return { content: NO_DECISION_MODEL, isError: true }
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)))
  const tab = input.previewId ? { previewId: input.previewId } : {}
  const history: GoalStep[] = []
  let stopped = `the ${GOAL_MAX_ACTIONS}-action limit`
  let model: string | undefined
  // The page as the last action left it: each action asks for its snapshot in the same relay
  // round trip, so a step costs one browser call and one decision, not two calls.
  let latest: PreviewSnapshot | undefined
  let retriedStale = false

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
    const ask = goalAsk({
      goal: input.goal,
      page: { url: snapshot.url, title: snapshot.title, text: pageText(snapshot.tree) },
      elements: snapshot.elements,
      values: input.values,
      history,
    })
    const outcome = await deps.decide(ask, { signal: input.signal })
    if (outcome.status !== 'answered') {
      stopped = `the decision model did not answer (${outcome.status})`
      break
    }
    model = outcome.model
    const pick = readGoal(outcome.answers, ask, input.values)
    if ('error' in pick) {
      stopped = pick.error
      break
    }
    const element = snapshot.elements.find((candidate) => candidate.ref === pick.ref)
    const step: GoalStep = {
      ...pick,
      ...(element ? { element: describeElement(element) } : {}),
    }
    if (pick.operation === 'DONE' || pick.operation === 'BLOCKED') {
      history.push(step)
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
        continue
      }
      history.push({ ...step, changed: false })
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
    if (repeated && !changed) {
      stopped = 'the same action twice without a visible change'
      break
    }
  }
  return finish(stopped)

  /** The trace and the page as it is now, for the agent to judge. */
  async function finish(reason: string): Promise<Result> {
    // The page the last step read or left, when there is one; else read it now.
    const final = latest
      ? { result: { action: 'snapshot' as const, snapshot: latest } }
      : await deps.send({ action: 'snapshot', ...tab })
    const lines = history.map((step, i) => `${i + 1}. ${traceLine(step)}`)
    const header = `Goal: ${input.goal}\nThe decision model${model ? ` (${model})` : ''} took ${history.length} ${history.length === 1 ? 'step' : 'steps'}; stopped: ${reason}.`
    const page =
      'error' in final
        ? `The final page could not be read: ${final.error}`
        : `Check the page yourself — DONE is not proof:\n\n${snapshotContent(final.result)}`
    return {
      content: [header, ...lines, '', page].join('\n'),
      details: { action: 'goal' },
      supersedeKey: 'browser',
    }
  }
}
