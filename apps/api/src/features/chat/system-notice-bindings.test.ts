import { describe, expect, test } from 'bun:test'

import { SYSTEM_AUTHOR } from '../../db'
import type { StoredSystemNotice } from '../../db/payload'
import type { PersistedMessage } from './contracts'
import { systemContextSelectionBinding } from '@localixai/agent'
import { currentSystemContextBindings, systemNoticeBinding } from './system-notice-bindings'

function noticeRow(id: string, notice: StoredSystemNotice): PersistedMessage {
  return {
    id,
    sessionId: 's1',
    userId: 'u1',
    createdAt: `2026-09-20T00:00:0${id}.000Z`,
    updatedAt: `2026-09-20T00:00:0${id}.000Z`,
    payload: {
      id,
      role: 'user',
      from: SYSTEM_AUTHOR,
      content: notice.text,
      uiOnly: true,
      systemNotice: notice,
      bindings: [systemNoticeBinding(notice, id, `2026-09-20T00:00:0${id}.000Z`)],
    },
  }
}

const model = (name: string, id: string) => ({
  kind: 'model_change' as const,
  tone: 'neutral' as const,
  text: `${name} is now on ${id}.`,
})

describe('system notice context bindings', () => {
  test('model-change spam collapses to the newest value in its slot', () => {
    const rows = [
      noticeRow('1', model('lead', 'model-b')),
      noticeRow('2', model('lead', 'model-a')),
      noticeRow('3', model('lead', 'model-b')),
    ]

    const bindings = currentSystemContextBindings(rows)

    expect(bindings.map((binding) => binding.target.token)).toEqual(['notice:model_change'])
    expect(bindings.map((binding) => binding.target.label)).toEqual(['lead is now on model-b.'])
  })

  test('only the newest run outcome survives across interruption kinds', () => {
    const rows = [
      noticeRow('1', { kind: 'run_failed', tone: 'warning', text: 'Provider failed.' }),
      noticeRow('2', { kind: 'turn_limit', tone: 'neutral', text: 'Turn limit reached.' }),
      noticeRow('3', { kind: 'run_interrupted', tone: 'warning', text: 'Run interrupted.' }),
    ]

    const bindings = currentSystemContextBindings(rows)

    expect(bindings).toHaveLength(1)
    expect(bindings[0].target.token).toBe('run:latest-status')
    expect(bindings[0].resolution.contributions[0]?.content).toBe('Run interrupted.')
  })

  test('a later assistant completion clears the stale run outcome', () => {
    const completed = noticeRow('2', {
      kind: 'model_change',
      tone: 'neutral',
      text: 'ignored',
    })
    completed.payload = {
      ...completed.payload,
      role: 'assistant',
      systemNotice: undefined,
      bindings: undefined,
    }
    const rows = [
      noticeRow('1', { kind: 'run_interrupted', tone: 'warning', text: 'Run interrupted.' }),
      completed,
    ]

    expect(currentSystemContextBindings(rows)).toHaveLength(0)
  })

  test('the latest user selection filters system context through a binding', () => {
    const model = noticeRow('1', {
      kind: 'model_change',
      tone: 'neutral',
      text: 'Model changed.',
    })
    const interrupted = noticeRow('2', {
      kind: 'run_interrupted',
      tone: 'warning',
      text: 'Run interrupted.',
    })
    const selection = noticeRow('3', {
      kind: 'connection_change',
      tone: 'neutral',
      text: 'selection carrier',
    })
    selection.payload.systemNotice = undefined
    selection.payload.uiOnly = undefined
    selection.payload.bindings = [systemContextSelectionBinding('s1', ['notice:model_change'])]

    expect(currentSystemContextBindings([model, interrupted, selection])).toMatchObject([
      { target: { token: 'notice:model_change' } },
    ])
  })

  test('upgrades a legacy notice row through the same binding constructor', () => {
    const row = noticeRow('1', {
      kind: 'connection_change',
      tone: 'neutral',
      text: 'Connection switched.',
    })
    row.payload.bindings = undefined

    const bindings = currentSystemContextBindings([row])

    expect(bindings[0]).toMatchObject({
      source: 'system',
      target: { token: 'notice:connection_change' },
    })
  })

  test('a session recap is a record of the transcript, never model context', () => {
    const recap = noticeRow('1', {
      kind: 'session_recap',
      tone: 'neutral',
      text: 'You were fixing the login redirect; next is the session cookie.',
    })
    const legacy = noticeRow('2', {
      kind: 'session_recap',
      tone: 'neutral',
      text: 'Another recap.',
    })
    legacy.payload.bindings = undefined

    expect(currentSystemContextBindings([recap, legacy])).toEqual([])
  })
})
