import { describe, expect, test } from 'bun:test'
import { createInlineCompletionContextResolver } from './context-resolvers'

describe('inline-completion surface grounding', () => {
  test('chat grounds itself in the visible conversation, as one admissible contribution', async () => {
    const resolve = createInlineCompletionContextResolver({
      chatService: {
        getInlineCompletionContext: async () => ({
          id: 's1',
          projectId: 'p1',
          rootSessionId: 's1',
          messages: [
            { payload: { role: 'user', content: 'Please validate it' } },
            { payload: { role: 'assistant', content: 'Internal note', isInternal: true } },
            { payload: { role: 'assistant', content: 'The tests pass' } },
          ],
        }),
      } as never,
    })

    const output = await resolve('u1', 's1', { surface: 'chat', payload: { draft: '' } })

    expect(output).toHaveLength(1)
    expect(output[0]).toMatchObject({ kind: 'conversation', providerId: 'localix.chat' })
    expect(output[0]!.content).toContain('Please validate it')
    expect(output[0]!.content).toContain('The tests pass')
    expect(output[0]!.content).not.toContain('Internal note')
  })

  test('a contributed surface nobody owns declines instead of failing the call', async () => {
    const resolve = createInlineCompletionContextResolver({ chatService: {} as never })
    expect(await resolve('u1', 's1', { surface: 'nobody.field', payload: {} })).toEqual([])
  })
})
