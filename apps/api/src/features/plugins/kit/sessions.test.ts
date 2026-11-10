import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadPlugin, type Plugin } from '@rsaryev/llx-plugin'
import { memoryFiles } from '@rsaryev/llx-plugin/testing'
import { tempDirPerTest } from '@localixai/testing'
import { createLocalixPluginHost } from './host'
import { createChatPluginSessions, type ChatSessionFacts, type ScopePlugin } from './sessions'

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
  return { host, chats: createChatPluginSessions(host) }
}

const loaded = new Map<string, Plugin>()
async function plugin(name: string): Promise<Plugin> {
  const files = memoryFiles({ '.claude-plugin/plugin.json': JSON.stringify({ name }) })
  const read = loaded.get(name) ?? (await loadPlugin({ files })).plugin
  if (!read) throw new Error('fixture does not load')
  loaded.set(name, read)
  return read
}

async function scoped(name: string, selected: boolean): Promise<ScopePlugin> {
  return { id: `${name}@acme`, root: `/plugins/${name}`, plugin: await plugin(name), selected }
}

const enabledIn = (session: { plugins: readonly { id: string; enabled: boolean }[] }) =>
  Object.fromEntries(session.plugins.map(({ id, enabled }) => [id, enabled]))

const facts = (over: Partial<ChatSessionFacts> = {}): ChatSessionFacts => ({
  chatId: 'chat-1',
  cwd: '/work/app',
  transcriptPath: '/data/chat-1.jsonl',
  permissionMode: 'default',
  trusted: true,
  layers: [],
  scope: '/work/app',
  plugins: [],
  ...over,
})

describe('one kit session per chat', () => {
  test('opens at the first run and keeps the same session for the later runs', () => {
    const { chats } = sessions()
    expect(chats.get('chat-1')).toBeUndefined()
    chats.forRun(facts())
    const opened = chats.get('chat-1')
    expect(opened).toBeDefined()
    // A run in another folder or mode is a turn of the same session: its `once` keys stay.
    chats.forRun(facts({ permissionMode: 'plan', cwd: '/work/app/sub' }))
    expect(chats.get('chat-1')).toBe(opened)
  })

  test('a chat whose trust or added folders change opens a new session', () => {
    const { chats } = sessions()
    chats.forRun(facts())
    const first = chats.get('chat-1')
    chats.forRun(facts({ trusted: false }))
    const untrusted = chats.get('chat-1')
    chats.forRun(facts({ trusted: false, addedDirectories: ['/shared'] }))
    expect(new Set([first, untrusted, chats.get('chat-1')]).size).toBe(3)
  })

  test('forgets a deleted chat, and forgetting twice does nothing', () => {
    const { chats } = sessions()
    chats.forRun(facts())
    chats.forRun(facts({ chatId: 'chat-2' }))
    chats.forget('chat-1')
    chats.forget('chat-1')
    expect([chats.get('chat-1'), chats.get('chat-2') !== undefined]).toEqual([undefined, true])
  })

  test('rejects a permission mode Claude Code does not name', () => {
    expect(() => sessions().chats.forRun(facts({ permissionMode: 'sometimes' }))).toThrow(
      /sometimes/,
    )
  })

  test("the host holds every scope's plugins; a session runs those its agent selected", async () => {
    const { host, chats } = sessions()
    const app = chats.forRun(facts({ plugins: [await scoped('fmt', true)] }))
    const other = chats.forRun(
      facts({
        chatId: 'chat-2',
        cwd: '/work/other',
        scope: '/work/other',
        plugins: [await scoped('fmt', false), await scoped('lint', true)],
      }),
    )
    expect(host.plugins().map(({ id }) => id)).toEqual(['fmt@acme', 'lint@acme'])
    expect(enabledIn(other)).toEqual({ 'fmt@acme': false, 'lint@acme': true })
    // The first chat's next run names the plugin another scope brought: it is off there.
    const next = chats.forRun(facts({ plugins: [await scoped('fmt', true)] }))
    expect(next).not.toBe(app)
    expect(enabledIn(next)).toEqual({ 'fmt@acme': true, 'lint@acme': false })
  })

  test("a change of the agent's selection opens a new session; the same one keeps it", async () => {
    const { chats } = sessions()
    chats.forRun(facts({ plugins: [await scoped('fmt', true)] }))
    const first = chats.get('chat-1')
    chats.forRun(facts({ plugins: [await scoped('fmt', true)] }))
    expect(chats.get('chat-1')).toBe(first)
    const off = chats.forRun(facts({ plugins: [await scoped('fmt', false)] }))
    expect(chats.get('chat-1')).not.toBe(first)
    expect(enabledIn(off)).toEqual({ 'fmt@acme': false })
  })

  test('managed settings turn off a plugin the agent selected', async () => {
    const { chats } = sessions()
    const session = chats.forRun(
      facts({
        plugins: [await scoped('fmt', true)],
        layers: [{ scope: 'managed', settings: { enabledPlugins: { 'fmt@acme': false } } }],
      }),
    )
    expect(enabledIn(session)).toEqual({ 'fmt@acme': false })
  })
})
