import { describe, expect, test } from 'bun:test'
import { shallow } from 'zustand/shallow'
import type { ParsedContextRef } from '@localixai/api/context-refs'
import type { UiSession } from '@/shared/api/contracts'
import type { ChatStore } from '../model/store'
import { selectRefLabelValues } from './refLabelSelector'

const ref = (patch: Partial<ParsedContextRef>): ParsedContextRef =>
  ({ key: 'ref', raw: '@ref', kind: 'session', ...patch }) as ParsedContextRef

const state = (patch: Partial<ChatStore> = {}) =>
  ({ sessions: [], allSessions: [], projects: [], ...patch }) as ChatStore
const session = (patch: Partial<UiSession>): UiSession => patch as UiSession

describe('selectRefLabelValues', () => {
  test('stays shallow-equal for unrelated streaming changes', () => {
    const refs = [ref({ sessionId: 'target' })]
    const target = session({ id: 'target', title: 'Target', messages: [] })
    const streaming = session({
      id: 'live',
      messages: [{ id: 'reply', role: 'assistant', content: 'a' }],
    })
    const before = selectRefLabelValues(
      state({ sessions: [target], allSessions: [target, streaming] }),
      refs,
    )
    const after = selectRefLabelValues(
      state({
        sessions: [target],
        allSessions: [
          target,
          { ...streaming, messages: [{ id: 'reply', role: 'assistant', content: 'ab' }] },
        ],
      }),
      refs,
    )

    expect(before).toEqual(['Target'])
    expect(shallow(before, after)).toBe(true)
  })
})
