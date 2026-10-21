import { describe, expect, test } from 'bun:test'
import { shallow } from 'zustand/shallow'
import type { UiSession } from '@/shared/api/contracts'
import { parentSessionForActive, runtimeSessionsForScope } from './RuntimeSessionsPanel'

const session = (id: string, patch: Partial<UiSession> = {}): UiSession =>
  ({ id, sessionKind: 'chat', runtimeStatus: 'idle', ...patch }) as UiSession

describe('runtimeSessionsForScope', () => {
  test('keeps unrelated message changes out of a scoped runtime projection', () => {
    const root = session('root')
    const child = session('child', { sessionKind: 'subagent', rootSessionId: root.id })
    const other = session('other', { sessionKind: 'job', rootSessionId: 'other-root' })
    const before = runtimeSessionsForScope([root, child, other], root.id)
    const after = runtimeSessionsForScope([{ ...root, messages: [] }, child, other], root.id)

    expect(before).toEqual([child])
    expect(after).toEqual([child])
    expect(after[0]).toBe(before[0])
    expect(shallow(before, after)).toBe(true)
  })

  test('shows only running runtime sessions when no scope is selected', () => {
    const running = session('running', { sessionKind: 'job', runtimeStatus: 'running' })
    const stopped = session('stopped', { sessionKind: 'subagent', runtimeStatus: 'stopped' })
    expect(runtimeSessionsForScope([running, stopped], null)).toEqual([running])
  })

  test('keeps nested runtime children in their root session scope', () => {
    const root = session('root')
    const worker = session('worker', {
      sessionKind: 'subagent',
      parentSessionId: root.id,
      rootSessionId: root.id,
    })
    const reviewer = session('reviewer', {
      sessionKind: 'subagent',
      parentSessionId: worker.id,
      rootSessionId: root.id,
    })
    expect(runtimeSessionsForScope([root, worker, reviewer], root.id).map((s) => s.id)).toEqual([
      'worker',
      'reviewer',
    ])
  })
})

describe('parentSessionForActive', () => {
  test('returns the immediate parent for a nested runtime session', () => {
    const root = session('root')
    const worker = session('worker', {
      sessionKind: 'subagent',
      parentSessionId: root.id,
      rootSessionId: root.id,
    })
    const reviewer = session('reviewer', {
      sessionKind: 'subagent',
      parentSessionId: worker.id,
      rootSessionId: root.id,
    })

    expect(parentSessionForActive([root, worker, reviewer], reviewer.id)).toBe(worker)
    expect(parentSessionForActive([root, worker, reviewer], worker.id)).toBe(root)
  })

  test('does not add a parent action for a root or missing active session', () => {
    const root = session('root')
    expect(parentSessionForActive([root], root.id)).toBeUndefined()
    expect(parentSessionForActive([root], 'missing')).toBeUndefined()
    expect(parentSessionForActive([root], null)).toBeUndefined()
  })
})
