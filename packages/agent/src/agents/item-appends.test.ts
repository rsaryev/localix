import { describe, expect, test } from 'bun:test'

import { applyItemAppend, diffItemsForAppends } from './item-appends'
import type { AgentItem } from './item-model'

const command = (id: string, output: string | undefined, extra: Record<string, unknown> = {}) =>
  ({
    id,
    toolCallId: id,
    type: 'command',
    status: 'running',
    name: 'bash',
    command: 'bun test',
    ...(output === undefined ? {} : { output }),
    ...extra,
  }) as unknown as AgentItem

const toolCall = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    toolCallId: id,
    type: 'tool_call',
    status: 'pending',
    name: 'write',
    activeVerb: 'Writing',
    ...extra,
  }) as unknown as AgentItem

const text = (id: string, value: string) =>
  ({ id, type: 'text', status: 'completed', text: value }) as unknown as AgentItem

const NO_PASSTHROUGH = new Set<string>()

describe('diffItemsForAppends', () => {
  test('same reference → no appends', () => {
    const items = [command('c1', 'out')]
    expect(diffItemsForAppends(items, items, NO_PASSTHROUGH)).toEqual([])
  })

  test('secondary narrative growth uses an addressed text append', () => {
    const prev = [text('text-0-2', 'A')]
    const next = [text('text-0-2', 'AB')]
    const [append] = diffItemsForAppends(prev, next, NO_PASSTHROUGH) ?? []
    expect(append).toEqual({ itemId: 'text-0-2', slot: 'text', append: 'B' })
    expect(applyItemAppend(prev[0], append!)).toMatchObject({ text: 'AB' })
  })

  test('narrative metadata: equal copies grow, a changed field is structural', () => {
    const withMeta = (value: string, meta: Record<string, unknown>) =>
      ({ ...(text('t', value) as object), ...meta }) as unknown as AgentItem
    const prev = [withMeta('A', { phase: 'final', refs: [{ id: 1 }] })]
    expect(
      diffItemsForAppends(
        prev,
        [withMeta('AB', { phase: 'final', refs: [{ id: 1 }] })],
        NO_PASSTHROUGH,
      ),
    ).toEqual([{ itemId: 't', slot: 'text', append: 'B' }])
    expect(
      diffItemsForAppends(
        prev,
        [withMeta('AB', { phase: 'draft', refs: [{ id: 1 }] })],
        NO_PASSTHROUGH,
      ),
    ).toBeNull()
    expect(
      diffItemsForAppends(
        prev,
        [withMeta('AB', { phase: 'final', refs: [{ id: 2 }] })],
        NO_PASSTHROUGH,
      ),
    ).toBeNull()
    expect(
      diffItemsForAppends(prev, [withMeta('AB', { phase: 'final' })], NO_PASSTHROUGH),
    ).toBeNull()
  })

  test('missing baseline or length change → structural', () => {
    const items = [command('c1', 'out')]
    expect(diffItemsForAppends(undefined, items, NO_PASSTHROUGH)).toBeNull()
    expect(diffItemsForAppends([], items, NO_PASSTHROUGH)).toBeNull()
  })

  test('unchanged items ride reference equality', () => {
    const stable = command('c1', 'done')
    const prev = [stable, command('c2', 'a')]
    const next = [stable, command('c2', 'ab')]
    expect(diffItemsForAppends(prev, next, NO_PASSTHROUGH)).toEqual([
      { itemId: 'c2', slot: 'output', append: 'b' },
    ])
  })

  test('command output suffix growth, including from undefined', () => {
    expect(
      diffItemsForAppends([command('c1', undefined)], [command('c1', 'hi')], NO_PASSTHROUGH),
    ).toEqual([{ itemId: 'c1', slot: 'output', append: 'hi' }])
  })

  test('output shrink or rewrite → structural', () => {
    expect(
      diffItemsForAppends([command('c1', 'abc')], [command('c1', 'ab')], NO_PASSTHROUGH),
    ).toBeNull()
    expect(
      diffItemsForAppends([command('c1', 'abc')], [command('c1', 'abd')], NO_PASSTHROUGH),
    ).toBeNull()
  })

  test('status change → structural', () => {
    expect(
      diffItemsForAppends(
        [command('c1', 'out')],
        [command('c1', 'out', { status: 'completed' })],
        NO_PASSTHROUGH,
      ),
    ).toBeNull()
  })

  test('streamed args: string key growth and key materialization', () => {
    const prev = [toolCall('w1', { input: { path: 'a.ts', content: 'const x' } })]
    const next = [toolCall('w1', { input: { path: 'a.ts', content: 'const x = 1', force: 'yes' } })]
    expect(diffItemsForAppends(prev, next, NO_PASSTHROUGH)).toEqual([
      { itemId: 'w1', slot: 'input', key: 'content', append: ' = 1' },
      { itemId: 'w1', slot: 'input', key: 'force', append: 'yes' },
    ])
  })

  test('input key vanishing or non-string change → structural', () => {
    expect(
      diffItemsForAppends(
        [toolCall('w1', { input: { a: 'x', b: 'y' } })],
        [toolCall('w1', { input: { a: 'x' } })],
        NO_PASSTHROUGH,
      ),
    ).toBeNull()
    expect(
      diffItemsForAppends(
        [toolCall('w1', { input: { n: 1 } })],
        [toolCall('w1', { input: { n: 2 } })],
        NO_PASSTHROUGH,
      ),
    ).toBeNull()
  })

  test('generic tool output record: streamed content string grows', () => {
    const prev = [toolCall('t1', { status: 'running', output: { content: 'chunk' } })]
    const next = [toolCall('t1', { status: 'running', output: { content: 'chunk chunk' } })]
    expect(diffItemsForAppends(prev, next, NO_PASSTHROUGH)).toEqual([
      { itemId: 't1', slot: 'output', key: 'content', append: ' chunk' },
    ])
  })

  test('current-turn text/reasoning growth passes through (carried by textAppend)', () => {
    const prev = [text('text-0', 'Hel'), command('c1', 'a')]
    const next = [text('text-0', 'Hello'), command('c1', 'ab')]
    expect(diffItemsForAppends(prev, next, new Set(['text-0']))).toEqual([
      { itemId: 'c1', slot: 'output', append: 'b' },
    ])
    // A non-primary narrative item gets its own addressed append.
    expect(diffItemsForAppends(prev, next, NO_PASSTHROUGH)).toEqual([
      { itemId: 'text-0', slot: 'text', append: 'lo' },
      { itemId: 'c1', slot: 'output', append: 'b' },
    ])
  })

  test('any other field change → structural', () => {
    expect(
      diffItemsForAppends(
        [command('c1', 'out')],
        [command('c1', 'out', { exitCode: 0 })],
        NO_PASSTHROUGH,
      ),
    ).toBeNull()
  })
})

describe('applyItemAppend', () => {
  test('round-trip: diff appends reproduce the next snapshot', () => {
    const prev = [
      command('c1', 'line1\n'),
      toolCall('w1', { input: { path: 'a.ts', content: 'con' } }),
      toolCall('t1', { status: 'running', output: { content: 'x' } }),
    ]
    const next = [
      command('c1', 'line1\nline2\n'),
      toolCall('w1', { input: { path: 'a.ts', content: 'const' } }),
      toolCall('t1', { status: 'running', output: { content: 'xy' } }),
    ]
    const appends = diffItemsForAppends(prev, next, NO_PASSTHROUGH)
    expect(appends).not.toBeNull()
    const rebuilt = prev.map((item) => {
      let grown = item
      for (const ap of appends ?? []) {
        if (ap.itemId !== grown.id) continue
        const applied = applyItemAppend(grown, ap)
        if (applied) grown = applied
      }
      return grown
    })
    expect(rebuilt).toEqual(next)
  })

  test('shape mismatch returns null (caller keeps the item, snapshot resyncs)', () => {
    const item = command('c1', undefined, { output: 5 } as Record<string, unknown>)
    expect(applyItemAppend(item, { itemId: 'c1', slot: 'output', append: 'x' })).toBeNull()
    expect(
      applyItemAppend(toolCall('w1', { input: 'not-a-record' }), {
        itemId: 'w1',
        slot: 'input',
        key: 'content',
        append: 'x',
      }),
    ).toBeNull()
  })

  test('append into an absent input record materializes it', () => {
    const grown = applyItemAppend(toolCall('w1'), {
      itemId: 'w1',
      slot: 'input',
      key: 'content',
      append: 'hi',
    })
    expect((grown as unknown as { input: Record<string, unknown> }).input).toEqual({
      content: 'hi',
    })
  })
})
