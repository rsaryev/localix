import { describe, expect, test } from 'bun:test'

import { handleMacroOrContextCommand } from './command-handlers-macros'

const session = { id: 's', userId: 'u' } as never
const history = [
  {
    id: 'm1',
    sessionId: 's',
    userId: 'u',
    payload: { id: 'm1', role: 'user', content: 'Keep this context.' },
    createdAt: 't',
    updatedAt: 't',
  },
] as never

describe('context command safety', () => {
  test('fails closed when an unsupported control value crosses an untyped boundary', async () => {
    let boundaryCalls = 0
    let directReplyCalls = 0

    const invocation = handleMacroOrContextCommand(
      {
        runner: { noteSessionStartSource: () => {} } as never,
        insertContextBoundary: async () => {
          boundaryCalls += 1
          return {} as never
        },
      },
      'future-command' as never,
      'u',
      's',
      session,
      history,
      '/future-command',
      't',
      async () => {
        directReplyCalls += 1
        return {} as never
      },
    )

    expect(invocation).rejects.toThrow('Unsupported macro/context control command: future-command')
    expect(boundaryCalls).toBe(0)
    expect(directReplyCalls).toBe(0)
  })

  test('/compact is not a synchronous mutation — the dispatcher owns it as a queue barrier', async () => {
    // The type narrows it away; the runtime guard must refuse it too if a value slips through.
    await expect(
      handleMacroOrContextCommand(
        {
          runner: { noteSessionStartSource: () => {} } as never,
          insertContextBoundary: async () => {
            throw new Error('must not create a boundary')
          },
        },
        'compact' as never,
        'u',
        's',
        session,
        history,
        '/compact',
        't',
        async () => ({}) as never,
      ),
    ).rejects.toThrow('Unsupported macro/context control command: compact')
  })
})
