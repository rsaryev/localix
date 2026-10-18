import { describe, expect, test } from 'bun:test'
import { SEALED_PLACEHOLDER, type AgentToolPresentation } from '@localixai/agent/agents'

import { createItemAccumulator, type ToolItemSpec } from './items'
import { SEALED_RESULT_TEXT, sealToolSpec } from './sealed-items'

const SECRET = 'rock-7f3a'

const spec = (patch: Partial<ToolItemSpec> = {}): ToolItemSpec => ({
  toolCallId: 'c1',
  name: 'game',
  status: 'completed',
  activeVerb: 'Playing',
  input: { action: 'play', move: SECRET },
  ...patch,
})

describe('sealToolSpec', () => {
  test('replaces only the declared input keys', () => {
    expect(sealToolSpec(spec(), { input: ['move'] }).input).toEqual({
      action: 'play',
      move: SEALED_PLACEHOLDER,
    })
  })

  test('leaves a spec without sealing, or without the key, untouched', () => {
    const plain = spec()
    expect(sealToolSpec(plain, undefined)).toBe(plain)
    const other = spec({ input: { action: 'state' } })
    expect(sealToolSpec(other, { input: ['move'] }).input).toBe(other.input)
  })

  test('a sealed result withholds text, details, error and media', () => {
    const sealed = sealToolSpec(
      spec({
        input: { action: 'state' },
        resultText: SECRET,
        details: { secret: SECRET },
        errorText: SECRET,
        error: { kind: 'execution', message: SECRET, userMessage: SECRET, personMessage: SECRET },
        sources: [{ id: 's', kind: 'web', title: SECRET } as never],
      }),
      { result: true },
    )
    expect(JSON.stringify(sealed)).not.toContain(SECRET)
    expect(sealed.resultText).toBe(SEALED_RESULT_TEXT)
    expect(sealed.error?.kind).toBe('execution')
  })

  test('is idempotent', () => {
    const once = sealToolSpec(spec({ resultText: SECRET }), { input: ['move'], result: true })
    expect(sealToolSpec(once, { input: ['move'], result: true })).toEqual(once)
  })
})

describe('createItemAccumulator with a sealed tool', () => {
  const presentation: AgentToolPresentation = { sealed: { input: ['move'], result: true } }
  const accumulator = () =>
    createItemAccumulator(() => 'Playing', {
      presentationFor: (name) => (name === 'game' ? presentation : undefined),
    })

  test('no copy of the item ever holds the secret: streamed, running, progress or ended', () => {
    const acc = accumulator()
    const seen: string[] = []
    const snapshot = () => seen.push(JSON.stringify(acc.list()))

    // `message_end` streams the raw arguments before the tool runs.
    acc.streamTool(0, { id: 'c1', name: 'game', arguments: { action: 'play', move: SECRET } })
    snapshot()
    acc.startTool(0, 'c1', 'game', { action: 'play', move: SECRET })
    snapshot()
    acc.updateToolDetails('c1', 'game', { progress: SECRET })
    snapshot()
    acc.endTool('c1', 'game', { status: 'completed', resultText: SECRET, details: { SECRET } })
    snapshot()

    for (const copy of seen) expect(copy).not.toContain(SECRET)
    expect(acc.list()[0]).toMatchObject({
      input: { action: 'play', move: SEALED_PLACEHOLDER },
      resultText: SEALED_RESULT_TEXT,
      presentation,
    })
  })

  test('a failed sealed call does not echo its input or error', () => {
    const acc = accumulator()
    acc.startTool(0, 'c1', 'game', { action: 'play', move: SECRET })
    acc.endTool('c1', 'game', { status: 'failed', errorText: `bad move ${SECRET}` })
    expect(JSON.stringify(acc.list())).not.toContain(SECRET)
  })

  test('other tools are untouched', () => {
    const acc = accumulator()
    acc.startTool(0, 'c2', 'read', { path: SECRET })
    expect(JSON.stringify(acc.list())).toContain(SECRET)
  })
})
