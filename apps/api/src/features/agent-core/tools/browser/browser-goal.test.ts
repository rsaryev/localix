import { describe, expect, test } from 'bun:test'
import type { DecisionAsk, DecisionOutcome } from '@localixai/plugin-sdk/backend'

import type {
  PreviewCommand,
  PreviewSendOutcome,
  PreviewSnapshot,
} from '../preview/preview-control'
import { NO_DECISION_MODEL, NO_ELEMENTS, runGoal } from './browser-goal'

/** A two-field page: typing into e1 then clicking Search shows results. */
function page(options: { elements?: boolean; snapshotAfter?: boolean } = {}) {
  const sent: PreviewCommand[] = []
  let typed = ''
  let searched = false
  const snapshot = (): PreviewSnapshot => ({
    tree: searched
      ? '- heading "3 flights to London"'
      : '- combobox "Where to?"\n- button "Search"',
    stats: { nodes: 2, interactive: 2, chars: 40 },
    url: 'https://example.test/',
    title: 'Flights',
    ...(options.elements === false
      ? {}
      : {
          elements: [
            { ref: 'e1', role: 'combobox', name: 'Where to?', value: typed, editable: true },
            { ref: 'e2', role: 'button', name: 'Search' },
          ],
        }),
  })
  const send = async (command: PreviewCommand): Promise<PreviewSendOutcome> => {
    sent.push(command)
    if (command.action === 'snapshot')
      return { ok: true, result: { action: 'snapshot', snapshot: snapshot() } }
    const step = command.steps![0]!
    if (step.action === 'type') typed = step.text ?? ''
    if (step.action === 'click' && step.ref === 'e2') searched = true
    const changed = step.action === 'type' || (step.action === 'click' && step.ref === 'e2')
    if (options.snapshotAfter && command.snapshotAfter)
      return { ok: true, result: { action: 'steps', snapshot: snapshot() } }
    return { ok: true, result: { action: 'steps', ...(changed ? { diff: '+ changed' } : {}) } }
  }
  return { send, sent }
}

const answered = (answers: Record<string, string>): DecisionOutcome => ({
  status: 'answered',
  model: 'jev',
  ms: 5,
  answers: Object.fromEntries(
    Object.entries(answers).map(([key, choice]) => [
      key,
      { type: 'choice', choice, probabilities: { [choice]: 0.9 } },
    ]),
  ),
})

/** A model that types, then clicks Search, then says DONE. */
function scripted(script: Record<string, string>[]) {
  const asked: DecisionAsk[] = []
  return {
    asked,
    decide: async (ask: DecisionAsk) => {
      asked.push(ask)
      return answered(script[Math.min(asked.length - 1, script.length - 1)]!)
    },
  }
}

const input = { goal: 'Search flights to London', values: ['London'], previewId: 'tab-1' }

describe('the goal action', () => {
  test('a target gone since the snapshot is looked at and decided again, not a failure', async () => {
    const tab = page()
    let stale = true
    const send = async (command: PreviewCommand): Promise<PreviewSendOutcome> => {
      if (command.action === 'steps' && stale) {
        stale = false
        return { ok: false, error: 'ref "e1" not found — the page changed', errorCode: 'not_found' }
      }
      return tab.send(command)
    }
    const model = scripted([
      { operation: 'TYPE_TEXT', type_target: 'e1', type_value: 'v1' },
      { operation: 'TYPE_TEXT', type_target: 'e1', type_value: 'v1' },
      { operation: 'CLICK', click_target: 'e2' },
      { operation: 'DONE' },
    ])
    const result = await runGoal({ send, decide: model.decide, sleep: async () => {} }, input)
    expect(model.asked).toHaveLength(4)
    expect(String(result.content)).toContain('stopped: the model judged the goal done')
  })

  test('each action brings back its page: one browser call per step', async () => {
    const tab = page({ snapshotAfter: true })
    const model = scripted([
      { operation: 'TYPE_TEXT', type_target: 'e1', type_value: 'v1' },
      { operation: 'CLICK', click_target: 'e2' },
      { operation: 'DONE' },
    ])
    const result = await runGoal(
      { send: tab.send, decide: model.decide, sleep: async () => {} },
      input,
    )
    // One snapshot to start, then the two actions — the page each left is read from its answer,
    // except after typing into a combobox that showed no options yet: it is looked at again.
    expect(tab.sent.map((command) => command.action)).toEqual([
      'snapshot',
      'steps',
      'snapshot',
      'steps',
    ])
    expect(
      tab.sent.filter((command) => command.action === 'steps').every((c) => c.snapshotAfter),
    ).toBe(true)
    // The model saw the typed value on the page the type left.
    expect(JSON.stringify(model.asked[1]!.state)).toContain('London')
    expect(String(result.content)).not.toContain('no visible change')
    expect(String(result.content)).toContain('3 flights to London')
  })

  test('drives the page step by step and returns the trace and the final page', async () => {
    const tab = page()
    const model = scripted([
      { operation: 'TYPE_TEXT', type_target: 'e1', type_value: 'v1' },
      { operation: 'CLICK', click_target: 'e2' },
      { operation: 'DONE' },
    ])
    const result = await runGoal(
      { send: tab.send, decide: model.decide, sleep: async () => {} },
      input,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('1. TYPE_TEXT combobox "Where to?" [e1] ← "London" · 90%')
    expect(result.content).toContain('2. CLICK button "Search" [e2] · 90%')
    expect(result.content).toContain('stopped: the model judged the goal done')
    expect(result.content).toContain('3 flights to London')
    expect(tab.sent.every((command) => command.previewId === 'tab-1')).toBe(true)
    // The second request already sees the typed value and the typing in its history.
    expect(JSON.stringify(model.asked[1]!.state)).toContain('= \\"London\\"')
  })

  test('stops on the same action twice without a visible change', async () => {
    const tab = page()
    const model = scripted([{ operation: 'CLICK', click_target: 'e1' }])
    const result = await runGoal({ send: tab.send, decide: model.decide }, input)
    expect(result.content).toContain('stopped: the same action twice without a visible change')
    expect(model.asked).toHaveLength(2)
  })

  test('a decision without answers stops with its reason', async () => {
    const tab = page()
    const result = await runGoal(
      { send: tab.send, decide: async () => ({ status: 'deadline', ms: 3000 }) },
      input,
    )
    expect(result.content).toContain('the decision model did not answer (deadline)')
  })

  test('without a decision model or an element list it says to use steps', async () => {
    expect((await runGoal({ send: page().send }, input)).content).toBe(NO_DECISION_MODEL)
    const result = await runGoal(
      { send: page({ elements: false }).send, decide: scripted([]).decide },
      input,
    )
    expect(result).toMatchObject({ content: NO_ELEMENTS, isError: true })
  })

  test('the step cap bounds a model that never finishes', async () => {
    let n = 0
    const send = async (command: PreviewCommand): Promise<PreviewSendOutcome> =>
      command.action === 'snapshot'
        ? {
            ok: true,
            result: {
              action: 'snapshot',
              snapshot: {
                tree: '',
                stats: { nodes: 1, interactive: 1, chars: 0 },
                url: 'u',
                title: 't',
                elements: [{ ref: 'e1', role: 'button', name: 'More' }],
              },
            },
          }
        : { ok: true, result: { action: 'steps', diff: `+ ${++n}` } }
    const result = await runGoal(
      { send, decide: async () => answered({ operation: 'CLICK', click_target: 'e1' }) },
      input,
    )
    expect(result.content).toContain('took 20 steps; stopped: the 20-action limit')
  })
})
