import { describe, expect, test } from 'bun:test'

import type { SessionRecord } from '../repository'
import { handleControlCommand } from './command-handlers'
import type { CommandHandlerContext } from './command-handlers-context'

const session = { id: 's', userId: 'u', title: 'Chat' } as SessionRecord

function reloadContext(opts: { replies: string[]; onChanged: () => void }) {
  return {
    now: () => '2026-07-31T00:00:00.000Z',
    pluginService: { onChanged: opts.onChanged },
    insertDirectReply: async (_u: string, sessionId: string, _p: string, text: string) => {
      opts.replies.push(text)
      return { sessionId, messageId: 'reply' }
    },
  } as unknown as CommandHandlerContext
}

describe('Claude Code reload spellings', () => {
  for (const word of ['/reload-plugins', '/reload-skills', '/Reload-Plugins']) {
    test(`${word} reloads the plugins, and with them their skills, like /plugin reload`, async () => {
      const replies: string[] = []
      let changed = 0
      await handleControlCommand(
        reloadContext({ replies, onChanged: () => changed++ }),
        'u',
        's',
        session,
        word,
      )
      expect(changed).toBe(1)
      expect(replies[0]).toContain('Plugins reloaded.')
      expect(replies[0]).toContain('skills')
    })
  }
})
