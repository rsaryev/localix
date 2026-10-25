import { describe, expect, test } from 'bun:test'

import { toModelMessages } from '@localixai/agent/agents/chat'

import { FORK_CALL_RESULT } from '../../../agent-core/tools/delegate-fork'
import { forkSnapshotPayload } from './fork-row'

const call = (
  id: string,
  name: string,
  status: string,
  turnIndex: number,
  resultText?: string,
) => ({
  type: 'tool_call',
  id: `item-${id}`,
  toolCallId: id,
  name,
  status,
  turnIndex,
  input: { id },
  ...(resultText !== undefined ? { resultText } : {}),
})

/** The parent's row as it stands while `delegate` is being called: step 0 done, step 1 in flight. */
const inFlight = () =>
  ({
    id: 'a2',
    role: 'assistant',
    from: 'agent:builtin:localix',
    content: '',
    usage: { contextTokens: 10 },
    items: [
      call('r1', 'read', 'completed', 0, 'file text'),
      call('r2', 'read', 'completed', 1, 'other file'),
      call('d1', 'delegate', 'running', 1),
      call('b1', 'bash', 'pending', 1),
    ],
  }) as never

describe('the fork’s copy of the parent’s row at the call', () => {
  test('is a new row with the parent’s items, the call and its unfinished siblings answered', () => {
    const copy = forkSnapshotPayload(inFlight(), 'd1', 'copy-1')
    expect(copy.id).toBe('copy-1')
    expect(copy.role).toBe('assistant')
    expect(copy.from).toBe('agent:builtin:localix')
    const items = copy.items as Array<{ toolCallId: string; status: string; resultText?: string }>
    expect(items.map((item) => [item.toolCallId, item.status, item.resultText])).toEqual([
      ['r1', 'completed', 'file text'],
      ['r2', 'completed', 'other file'],
      ['d1', 'completed', FORK_CALL_RESULT],
      ['b1', 'completed', FORK_CALL_RESULT],
    ])
  })

  test('carries nothing of the run that is still going (usage, diagnostics)', () => {
    expect('usage' in forkSnapshotPayload(inFlight(), 'd1', 'copy-1')).toBe(false)
  })

  test('is hidden from the fork’s own transcript while the model still reads it', () => {
    expect(forkSnapshotPayload(inFlight(), 'd1', 'copy-1').isInternal).toBe(true)
  })

  test('has no reply of its own: what the parent had said is in its items, not its content', () => {
    const parent = { ...(inFlight() as object), content: 'the parent’s words so far' } as never
    expect(forkSnapshotPayload(parent, 'd1', 'copy-1').content).toBe('')
  })

  test('reads on the wire as the call followed by one answer for each call of its step', () => {
    const wire = toModelMessages([forkSnapshotPayload(inFlight(), 'd1', 'copy-1')] as never)
    const results = wire
      .filter((message) => message.role === 'tool')
      .flatMap((message) => (message as { results: Array<{ toolCallId: string }> }).results)
    expect(results.map((result) => result.toolCallId)).toEqual(['r1', 'r2', 'd1', 'b1'])
    expect(JSON.stringify(wire)).not.toContain('still running')
  })

  test('leaves the parent’s own row as it was', () => {
    const parent = inFlight() as { items: Array<{ status: string }> }
    forkSnapshotPayload(parent as never, 'd1', 'copy-1')
    expect(parent.items[2]!.status).toBe('running')
  })

  test('refuses a call that is not in the row', () => {
    expect(() => forkSnapshotPayload(inFlight(), 'nope', 'copy-1')).toThrow(/nope/)
  })
})
