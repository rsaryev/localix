import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'
import {
  createChatPluginSessions,
  createLocalixPluginHost,
  readClaudeSettingsSync,
} from '../../../plugins/kit'
import { openChatPluginSession } from './chat-plugin-session'

const dir = tempDirPerTest('chat-plugin-session')

function sessions() {
  return createChatPluginSessions(
    createLocalixPluginHost({
      homeDir: dir(),
      environment: () => ({}),
      pluginsRoot: () => join(dir(), 'plugins'),
      scratchDir: () => join(dir(), 'scratch'),
      envFilesDir: (sessionId) => join(dir(), sessionId),
      managedDirectory: undefined,
      mcp: () => undefined,
      models: () => undefined,
    }),
  )
}

const facts = () => ({
  chatId: 's1',
  cwd: '/work/app',
  settings: readClaudeSettingsSync({ homeDir: dir(), cwd: '/work/app', env: {}, managed: null }),
})

describe("a run opens its chat's plugin session", () => {
  test('the first run opens it in every mode Localix has, a later run keeps it', () => {
    const chats = sessions()
    openChatPluginSession(chats, facts(), '/data/s1.jsonl', undefined)
    const opened = chats.get('s1')
    expect(opened).toBeDefined()
    for (const mode of ['plan', 'bypass', 'autonomous', 'default'] as const)
      openChatPluginSession(chats, facts(), '/data/s1.jsonl', mode)
    expect(chats.get('s1')).toBe(opened)
  })

  test('a runtime without the kit host opens nothing', () => {
    expect(() => openChatPluginSession(undefined, facts(), '/data/s1.jsonl', 'plan')).not.toThrow()
  })
})
