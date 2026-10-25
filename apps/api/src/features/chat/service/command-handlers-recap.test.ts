import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../repository'
import type { RecapResult } from '../recap/service'
import { handleControlCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'

const session = { id: 's', userId: 'u', title: 'Chat' } as SessionRecord

function run(result: RecapResult) {
  const replies: string[] = []
  const asked: unknown[][] = []
  const ctx = {
    now: () => '2026-10-25T10:00:00.000Z',
    recap: async (...args: unknown[]) => {
      asked.push(args)
      return result
    },
    insertDirectReply: async (_u: string, sessionId: string, _p: string, text: string) => {
      replies.push(text)
      return { sessionId, messageId: 'reply' }
    },
  } as unknown as CommandHandlerContext
  return { replies, asked, go: () => handleControlCommand(ctx, 'u', 's', session, '/recap') }
}

describe('/recap', () => {
  test('writes the recap into the chat in place of the typed command', async () => {
    const t = run({ status: 'created', text: 'You were fixing login.', messageId: 'recap-1' })
    expect(await t.go()).toEqual({ sessionId: 's', messageId: 'recap-1' })
    expect(t.replies).toEqual([])
    expect(t.asked).toEqual([['u', 's', 'command', { settleOptimistic: true }]])
  })

  test('says so when there is nothing to recap yet', async () => {
    const t = run({ status: 'skipped', reason: 'too-few-turns' })
    await t.go()
    expect(t.replies).toEqual(['Nothing to recap yet — send a message and wait for the reply.'])
  })

  test('asks to wait while a reply is being written', async () => {
    const t = run({ status: 'skipped', reason: 'running' })
    await t.go()
    expect(t.replies[0]).toContain('still being written')
  })

  test('points to the model row when no recap could be written', async () => {
    const t = run({ status: 'unavailable' })
    await t.go()
    expect(t.replies[0]).toContain('Session recap')
    expect(t.replies[0]).toContain('model picker')
  })
})
