import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import {
  createChatPluginSessions,
  createLocalixPluginHost,
  readClaudeSettingsSync,
  readPluginFolder,
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
  projectId: 'PRJ-1',
  cwd: '/work/app',
  plugins: [],
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

  test("the run's catalog reaches the host, and its agent's selection decides what runs", async () => {
    const chats = sessions()
    const root = join(dir(), 'fmt')
    writeTree(root, { '.claude-plugin/plugin.json': JSON.stringify({ name: 'fmt' }) })
    const plugin = (await readPluginFolder(root)).kit!
    const selection = (selected: boolean) => ({
      ...facts(),
      plugins: [{ id: 'fmt@acme', root, plugin, selected }],
    })
    openChatPluginSession(chats, selection(false), '/data/s1.jsonl', 'default')
    expect(chats.get('s1')?.plugins).toEqual([{ id: 'fmt@acme', name: 'fmt', enabled: false }])
    openChatPluginSession(chats, selection(true), '/data/s1.jsonl', 'default')
    expect(chats.get('s1')?.plugins).toEqual([{ id: 'fmt@acme', name: 'fmt', enabled: true }])
  })
})
