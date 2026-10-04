/// <reference types="bun" />

import { describe, test, expect } from 'bun:test'
import type { PersistedMessage } from '../contracts'
import {
  buildLspErrorReminder,
  buildTurnBudgetReminder,
  reminderSections,
  type OpenErrorInfo,
} from './reminders'
import { buildToolItem } from './items'
import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../../db'

let seq = 0
function msg(
  role: 'user' | 'assistant',
  opts: { isInternal?: boolean; toolTypes?: string[]; toolInput?: unknown } = {},
): PersistedMessage {
  const id = `m${seq++}`
  return {
    id,
    sessionId: 's',
    userId: 'u',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    payload: {
      id,
      role,
      from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
      content: '',
      ...(opts.isInternal ? { isInternal: true } : {}),
      ...(opts.toolTypes
        ? {
            items: opts.toolTypes.map((type, i) => {
              const name = type.startsWith('tool-') ? type.slice(5) : type
              const path = (opts.toolInput as { path?: string } | undefined)?.path
              const details =
                name === 'apply_patch'
                  ? path
                    ? { files: [{ path }] }
                    : undefined
                  : name === 'write'
                    ? path
                      ? { path }
                      : undefined
                    : undefined
              return buildToolItem({
                toolCallId: `${id}-${i}`,
                name,
                status: 'completed',
                input: opts.toolInput,
                details,
                activeVerb: 'Running',
              })
            }),
          }
        : {}),
    },
  }
}

const errs: OpenErrorInfo[] = [
  { file: 'src/a.ts', count: 2 },
  { file: 'src/b.ts', count: 1 },
]

describe('buildLspErrorReminder', () => {
  test('returns null when there are no open errors', () => {
    expect(buildLspErrorReminder([msg('user')], [])).toBeNull()
    expect(buildLspErrorReminder([msg('user')], undefined)).toBeNull()
  })

  test('fires when errors are open and the last turn did NOT edit files', () => {
    // Last assistant turn only read a file → inline diagnostics did not appear.
    const history = [msg('user'), msg('assistant', { toolTypes: ['tool-read'] })]
    const reminder = buildLspErrorReminder(history, errs)
    expect(reminder).not.toBeNull()
    expect(reminder).toContain('<system-reminder>')
    expect(reminder).toContain('3 unresolved errors')
    expect(reminder).toContain('src/a.ts (2 errors)')
    expect(reminder).toContain('src/b.ts (1 error)')
    expect(reminder).toContain('never mention it to the user')
  })

  test('is suppressed right after an edit (errors were just shown inline)', () => {
    const history = [msg('user'), msg('assistant', { toolTypes: ['tool-apply_patch'] })]
    expect(buildLspErrorReminder(history, errs)).toBeNull()
  })

  test('suppressed after write too', () => {
    expect(
      buildLspErrorReminder([msg('assistant', { toolTypes: ['tool-write'] })], errs),
    ).toBeNull()
  })

  test('re-fires once the model moves to a non-edit turn after editing', () => {
    // user → edit → user(again) → assistant(bash): the edit is older than the last user turn.
    const history = [
      msg('assistant', { toolTypes: ['tool-apply_patch'] }),
      msg('user'),
      msg('assistant', { toolTypes: ['tool-bash'] }),
    ]
    expect(buildLspErrorReminder(history, errs)).not.toBeNull()
  })

  test('caps the file list at 8 and reports the overflow', () => {
    const many: OpenErrorInfo[] = Array.from({ length: 11 }, (_, i) => ({
      file: `f${i}.ts`,
      count: 1,
    }))
    const reminder = buildLspErrorReminder([msg('assistant', { toolTypes: ['tool-read'] })], many)
    expect(reminder).toContain('… and 3 more files')
  })
})

/**
 * The reminders ride the turn's runtime context as keyed `state` sections: sent when they
 * change and left where they were sent. As a message rebuilt every turn they rewrote history
 * the model had already seen, which broke the prefix cache and preserved thinking.
 */
describe('reminderSections', () => {
  test('keys each reminder as a state section', () => {
    const history = [msg('user'), msg('assistant', { toolTypes: ['tool-read'] })]
    const sections = reminderSections(history, { maxTurns: 5, openErrors: errs })
    expect(sections.map(({ key, scope }) => ({ key, scope }))).toEqual([
      { key: 'turn-budget', scope: 'state' },
      { key: 'lsp-errors', scope: 'state' },
    ])
    expect(sections[1]!.text).toContain('unresolved error')
  })

  test('nothing to remind about → no sections', () => {
    const history = [msg('user'), msg('assistant', { toolTypes: ['tool-apply_patch'] })]
    expect(reminderSections(history, { openErrors: errs })).toEqual([])
    expect(reminderSections(history, {})).toEqual([])
  })

  test('the same facts render the same bytes, so an unchanged state sends no delta', () => {
    const history = [msg('user'), msg('assistant', { toolTypes: ['tool-read'] })]
    const first = reminderSections(history, { maxTurns: 3, openErrors: errs })
    const second = reminderSections(history, { maxTurns: 3, openErrors: errs })
    expect(second).toEqual(first)
  })
})

describe('buildTurnBudgetReminder — the agent is told what it may spend', () => {
  test('a low cap is stated, so the agent can front-load instead of being cut off', () => {
    // Observed: a run capped at a few turns opened a long investigation and was cut off before
    // it said anything, because nothing had told it the run was short.
    const reminder = buildTurnBudgetReminder(5)!
    expect(reminder).toContain('<system-reminder>')
    expect(reminder).toContain('5 agentic turns')
    expect(reminder).toContain('Budget accordingly')
  })

  test('one turn reads as one turn', () => {
    expect(buildTurnBudgetReminder(1)).toContain('1 agentic turn ')
  })

  test('a cap the agent cannot plan against is not mentioned at all', () => {
    // "You have a thousand turns" costs tokens to say and changes no decision, and a reminder
    // that is always present is one the model stops reading.
    expect(buildTurnBudgetReminder(1000)).toBeNull()
    expect(buildTurnBudgetReminder(undefined)).toBeNull()
  })

  test('it says the limit is the operator’s, not a target to spend', () => {
    // Without this a model treats the number as a quota and keeps working to reach it.
    expect(buildTurnBudgetReminder(3)).toContain('not a target')
  })
})
