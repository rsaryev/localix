/**
 * PlanOptions.opFloor — cross-run monotonicity memory for the VBC plan.
 *
 * Under a BINDING budget the greedy allocator re-ranks as recency shifts with
 * every appended message, so an old bash dump could bounce truncate → verbatim
 * across runs — re-billing its full body and breaking the provider prefix cache
 * (measured offline: 92 → 11 re-inflations on the coding/128k
 * profile). The floor pins every non-locked message at the strongest menu index
 * it has ever received; locked (first/tail) messages stay exempt so a message
 * re-entering the protected tail after a compaction comes back verbatim.
 */
import { describe, it, expect } from 'bun:test'
import type { ChatMessage } from '../chat'
import { planContextCompression } from './plan'
import type { OperationFloor } from './op-floor'
import { HUGE_BUDGET } from './_test-helpers'

const bashMsg = (i: number, chars: number): ChatMessage =>
  ({
    id: `m${i}`,
    role: 'assistant',
    content: '',
    items: [
      {
        id: `i${i}`,
        type: 'command',
        toolCallId: `t${i}`,
        name: 'Bash',
        status: 'completed',
        input: { command: `bun test suite-${i}` },
        output: 'x',
        resultText: `run ${i}\n` + 'L'.repeat(chars),
        turnIndex: 0,
      },
    ],
  }) as unknown as ChatMessage

const history = (n: number): ChatMessage[] => [
  { id: 'u0', role: 'user', content: 'the original task' } as ChatMessage,
  ...Array.from({ length: n }, (_, k) => bashMsg(k + 1, 8_000)),
]

const kindByIndex = (
  msgs: ChatMessage[],
  opts: { budget: number; opFloor?: Map<string, OperationFloor> },
) => {
  const plan = planContextCompression(msgs, {
    budget: opts.budget,
    keepRecentCount: 2,
    keepRecentTokens: 4_000,
    boundaryQuantum: 1, // no quantization noise — lock exactly first + tail
    ...(opts.opFloor ? { opFloor: opts.opFloor } : {}),
  })
  return new Map(plan.assignment.map((a) => [msgs[a.index].id, a.op.kind]))
}

describe('planContextCompression — opFloor monotonicity memory', () => {
  it('without a floor, a relaxed budget re-inflates previously-downgraded messages (the failure mode)', () => {
    const msgs = history(12)
    const tight = kindByIndex(msgs, { budget: 6_000 })
    const relaxed = kindByIndex(msgs, { budget: HUGE_BUDGET })
    const downgraded = [...tight.entries()].filter(([, k]) => k !== 'verbatim').map(([id]) => id)
    expect(downgraded.length).toBeGreaterThan(0)
    // sanity: the same allocator, given room, hands the content back verbatim
    expect(downgraded.some((id) => relaxed.get(id) === 'verbatim')).toBe(true)
  })

  it('with a floor, a message never receives a lighter op than it ever had', () => {
    const msgs = history(12)
    const floor = new Map<string, OperationFloor>()
    const tight = kindByIndex(msgs, { budget: 6_000, opFloor: floor })
    const downgraded = [...tight.entries()].filter(([, k]) => k !== 'verbatim').map(([id]) => id)
    expect(downgraded.length).toBeGreaterThan(0)
    expect(floor.size).toBeGreaterThan(0)

    // next run: budget pressure gone (e.g. huge window) — floored messages hold
    const relaxed = kindByIndex(msgs, { budget: HUGE_BUDGET, opFloor: floor })
    for (const id of downgraded) {
      expect(relaxed.get(id)).toBe(tight.get(id) as never)
    }
  })

  it('keeps a lossy floor stable when a newly available elide shifts the menu', () => {
    const mixed = (id: string, readPath: string): ChatMessage =>
      ({
        id,
        role: 'assistant',
        content: '',
        items: [
          {
            id: `${id}-read`,
            type: 'tool_call',
            toolCallId: `${id}-read`,
            name: 'Read',
            status: 'completed',
            input: { path: readPath },
            resultText: 'source\n'.repeat(2_000),
          },
          {
            id: `${id}-bash`,
            type: 'command',
            toolCallId: `${id}-bash`,
            name: 'Bash',
            status: 'completed',
            input: { command: 'bun test' },
            output: 'x',
            resultText: 'test output\n'.repeat(2_000),
            turnIndex: 0,
          },
        ],
      }) as unknown as ChatMessage
    const first: ChatMessage[] = [
      { id: 'u0', role: 'user', content: 'task' } as ChatMessage,
      mixed('mixed', '/repo/a.ts'),
      bashMsg(7, 100),
      bashMsg(8, 100),
      bashMsg(9, 100),
    ]
    const floor = new Map<string, OperationFloor>()
    const tight = kindByIndex(first, { budget: 1_000, opFloor: floor })
    const originalKind = tight.get('mixed')
    if (originalKind !== 'truncate' && originalKind !== 'oneline' && originalKind !== 'pointer') {
      throw new Error(`Expected a lossy floor, received ${String(originalKind)}`)
    }
    expect(floor.get('mixed')?.kind).toBe(originalKind)

    // A newer read of the same path makes the old read recoverable. That inserts
    // `elide` at menu index 1; the previous numeric floor reinterpreted its index
    // and handed the large bash output back verbatim.
    const next = [...first, mixed('newer-read', '/repo/a.ts')]
    const relaxed = kindByIndex(next, { budget: HUGE_BUDGET, opFloor: floor })
    expect(relaxed.get('mixed')).toBe(originalKind)
  })

  it('locked messages are exempt: the protected tail comes back verbatim despite a recorded floor', () => {
    const msgs = history(12)
    const floor = new Map<string, OperationFloor>()
    kindByIndex(msgs, { budget: 6_000, opFloor: floor })
    // shrink the history so a previously-floored middle message lands in the
    // protected recent tail (post-compaction shape)
    const flooredIds = [...floor.keys()]
    expect(flooredIds.length).toBeGreaterThan(0)
    const survivorId = flooredIds[flooredIds.length - 1]
    const survivor = msgs.find((m) => m.id === survivorId) as ChatMessage
    const compacted: ChatMessage[] = [msgs[0], survivor]
    const after = kindByIndex(compacted, { budget: HUGE_BUDGET, opFloor: floor })
    expect(after.get(survivorId)).toBe('verbatim')
  })

  it('records only meaningful floors (verbatim assignments are not stored)', () => {
    const msgs = history(6)
    const floor = new Map<string, OperationFloor>()
    kindByIndex(msgs, { budget: HUGE_BUDGET, opFloor: floor })
    expect(floor.size).toBe(0)
  })
})
