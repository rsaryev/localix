import { describe, expect, test } from 'bun:test'

import type { PreviewSnapshotElement } from '../preview/preview-control'
import {
  describeElement,
  goalAsk,
  pageText,
  readGoal,
  traceLine,
  type GoalStep,
} from './browser-goal-ask'

const elements: PreviewSnapshotElement[] = [
  { ref: 'e1', role: 'combobox', name: 'Where to?', value: '', editable: true },
  { ref: 'e2', role: 'button', name: 'Search' },
  { ref: 'e3', role: 'button', name: 'Book', states: ['disabled'] },
  { ref: 'e4', role: 'checkbox', name: 'Direct only', states: ['unchecked'] },
]
const base = {
  goal: 'Search flights to London',
  page: { url: 'https://example.test/', title: 'Flights' },
  elements,
  values: ['London'],
  history: [] as GoalStep[],
}

const choice = (key: string, p = 0.9) => ({
  type: 'choice' as const,
  choice: key,
  probabilities: { [key]: p },
})

describe('the question one goal step asks', () => {
  test('offers each operation only its own targets, and never a disabled one', () => {
    const ask = goalAsk(base)
    expect(Object.keys(ask.questions.operation!.criteria)).toEqual([
      'CLICK',
      'TYPE_TEXT',
      'SCROLL_DOWN',
      'SCROLL_UP',
      'WAIT',
      'DONE',
      'BLOCKED',
    ])
    expect(Object.keys(ask.questions.click_target!.criteria)).toEqual(['e1', 'e2', 'e4'])
    expect(Object.keys(ask.questions.type_target!.criteria)).toEqual(['e1'])
    expect(ask.questions.type_value!.criteria).toEqual({ v1: 'London' })
    expect(ask.state.elements).toContain('[e4] checkbox "Direct only" [unchecked]')
  })

  test('typing is not offered without values; Enter only right after typing', () => {
    const ask = goalAsk({ ...base, values: [] })
    expect(ask.questions.type_target).toBeUndefined()
    expect(Object.keys(ask.questions.operation!.criteria)).not.toContain('TYPE_TEXT')
    const typed: GoalStep = { operation: 'TYPE_TEXT', ref: 'e1', value: 'London', probability: 0.8 }
    expect(
      Object.keys(goalAsk({ ...base, history: [typed] }).questions.operation!.criteria),
    ).toContain('PRESS_ENTER')
  })

  test('only the head of the chosen operation is read, and its pick must be offered', () => {
    const ask = goalAsk(base)
    expect(
      readGoal(
        {
          operation: choice('TYPE_TEXT', 0.7),
          type_target: choice('e1'),
          type_value: choice('v1'),
          click_target: choice('e9'),
        },
        ask,
        base.values,
      ),
    ).toEqual({ operation: 'TYPE_TEXT', ref: 'e1', value: 'London', probability: 0.7 })
    expect(
      readGoal({ operation: choice('CLICK'), click_target: choice('e3') }, ask, base.values),
    ).toEqual({
      error: 'The decision model named no offered element to click.',
    })
    expect(readGoal({ operation: choice('FLY') }, ask, base.values)).toMatchObject({
      error: expect.any(String),
    })
  })

  test('elements and steps read as one line each', () => {
    expect(
      describeElement({
        ref: 'e1',
        role: 'textbox',
        name: 'From',
        value: 'Zurich',
        states: ['expanded'],
      }),
    ).toBe('textbox "From" = "Zurich" [expanded]')
    expect(
      traceLine({
        operation: 'CLICK',
        ref: 'e2',
        element: 'button "Search"',
        probability: 0.914,
        changed: false,
      }),
    ).toBe('CLICK button "Search" [e2] · 91% · no visible change')
  })
})

describe('what the model is offered on a busy page', () => {
  const el = (ref: string, role: string, name: string, extra = {}) => ({
    ref,
    role,
    name,
    ...extra,
  })

  test('an open dialog scopes the targets to its controls', () => {
    const ask = goalAsk({
      goal: 'Pick Oct 30 and search',
      page: { url: 'https://x.test', title: 'Flights' },
      elements: [
        el('e1', 'combobox', 'Where to?', { editable: true }),
        el('e2', 'gridcell', '30', { dialog: true }),
        el('e3', 'button', 'Done', { dialog: true }),
      ],
      values: [],
      history: [],
    })
    expect(Object.keys(ask.questions.click_target!.criteria)).toEqual(['e2', 'e3'])
    expect(ask.state).toMatchObject({ dialog_open: true })
  })

  test('a scroll that changed nothing is not offered again, nor a fourth scroll in a row', () => {
    const base = {
      goal: 'g',
      page: { url: 'https://x.test', title: 't' },
      elements: [el('e1', 'button', 'Go')],
      values: [],
    }
    const scroll = (changed: boolean) =>
      ({ operation: 'SCROLL_DOWN', probability: 0.5, changed }) as const
    const offered = (history: readonly ReturnType<typeof scroll>[]) =>
      Object.keys(goalAsk({ ...base, history }).questions.operation!.criteria)
    expect(offered([scroll(false)])).not.toContain('SCROLL_DOWN')
    expect(offered([scroll(false)])).toContain('SCROLL_UP')
    expect(offered([scroll(true), scroll(true), scroll(true)])).not.toContain('SCROLL_UP')
    expect(offered([scroll(true)])).toContain('SCROLL_DOWN')
  })

  test('the page text carries content lines, not controls or refs', () => {
    const tree = [
      '- heading 1 "Flights" [ref=e1]',
      '  - button "Search" [ref=e2]',
      '  - text "24 results" [ref=e3]',
      '  - cell "€122" [ref=e4]',
    ].join('\n')
    expect(pageText(tree)).toBe('Flights · 24 results · €122')
  })
})
