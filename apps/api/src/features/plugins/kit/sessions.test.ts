import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import { createLocalixPluginHost } from './host'
import { createChatPluginSessions, type ChatSessionFacts } from './sessions'

const dir = tempDirPerTest('kit-sessions')

function sessions() {
  const host = createLocalixPluginHost({
    homeDir: dir(),
    environment: () => ({ PATH: process.env.PATH }),
    pluginsRoot: () => join(dir(), 'plugins'),
    scratchDir: () => join(dir(), 'scratch'),
    envFilesDir: (sessionId) => join(dir(), 'sessions', sessionId),
    managedDirectory: undefined,
    mcp: () => undefined,
    models: () => undefined,
  })
  return createChatPluginSessions(host)
}

const facts = (over: Partial<ChatSessionFacts> = {}): ChatSessionFacts => ({
  chatId: 'chat-1',
  cwd: '/work/app',
  transcriptPath: '/data/chat-1.jsonl',
  permissionMode: 'default',
  trusted: true,
  ...over,
})

describe('one kit session per chat', () => {
  test('opens at the first run and keeps the same session for the later runs', () => {
    const chats = sessions()
    expect(chats.get('chat-1')).toBeUndefined()
    chats.forRun(facts())
    const opened = chats.get('chat-1')
    expect(opened).toBeDefined()
    // A run in another folder or mode is a turn of the same session: its `once` keys stay.
    chats.forRun(facts({ permissionMode: 'plan', cwd: '/work/app/sub' }))
    expect(chats.get('chat-1')).toBe(opened)
  })

  test('a chat whose trust or added folders change opens a new session', () => {
    const chats = sessions()
    chats.forRun(facts())
    const first = chats.get('chat-1')
    chats.forRun(facts({ trusted: false }))
    const untrusted = chats.get('chat-1')
    chats.forRun(facts({ trusted: false, addedDirectories: ['/shared'] }))
    expect(new Set([first, untrusted, chats.get('chat-1')]).size).toBe(3)
  })

  test('forgets a deleted chat, and forgetting twice does nothing', () => {
    const chats = sessions()
    chats.forRun(facts())
    chats.forRun(facts({ chatId: 'chat-2' }))
    chats.forget('chat-1')
    chats.forget('chat-1')
    expect([chats.get('chat-1'), chats.get('chat-2') !== undefined]).toEqual([undefined, true])
  })

  test('rejects a permission mode Claude Code does not name', () => {
    expect(() => sessions().forRun(facts({ permissionMode: 'sometimes' }))).toThrow(/sometimes/)
  })
})
