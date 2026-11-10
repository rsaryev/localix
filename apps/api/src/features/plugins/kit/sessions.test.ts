import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadPlugin, type Plugin } from '@rsaryev/llx-plugin'
import { memoryFiles } from '@rsaryev/llx-plugin/testing'
import { tempDirPerTest } from '@localixai/testing'
import { createLocalixPluginHost } from './host'
import {
  createChatPluginSessions,
  sessionLocations,
  type ChatSessionFacts,
  type ScopePlugin,
} from './sessions'

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

async function scoped(
  name: string,
  selected: boolean,
  over: Partial<ScopePlugin> = {},
): Promise<ScopePlugin> {
  const at = over.scope === 'project' ? `/work/app/.localix/plugins/${name}` : `/plugins/${name}`
  return {
    id: `${name}@acme`,
    root: at,
    plugin: await plugin(name),
    selected,
    scope: 'user',
    values: {},
    ...over,
  }
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

  test("the host holds the user installs; a project's own run in its sessions only", async () => {
    const { host, chats } = sessions()
    const app = chats.forRun(
      facts({
        plugins: [await scoped('fmt', true), await scoped('lint', true, { scope: 'project' })],
      }),
    )
    const other = chats.forRun(
      facts({ chatId: 'chat-2', cwd: '/work/other', plugins: [await scoped('fmt', false)] }),
    )
    expect(host.plugins().map(({ id }) => id)).toEqual(['fmt@acme'])
    expect(enabledIn(app)).toEqual({ 'fmt@acme': true, 'lint@acme': true })
    expect(enabledIn(other)).toEqual({ 'fmt@acme': false })
  })

  test("the host's user installs are the last catalog's", async () => {
    const { chats } = sessions()
    chats.forRun(facts({ plugins: [await scoped('fmt', true)] }))
    const other = chats.forRun(facts({ chatId: 'chat-2', plugins: [await scoped('lint', true)] }))
    expect(enabledIn(other)).toEqual({ 'lint@acme': true })
    const later = chats.forRun(facts({ plugins: [await scoped('fmt', true)] }))
    // Each catalog's user installs replace the host's.
    expect(enabledIn(later)).toEqual({ 'fmt@acme': true })
  })

  test("a project's own plugins run from its folder with the values saved for the chat", async () => {
    const { host, chats } = sessions()
    const lint = await scoped('lint', true, { scope: 'project', values: { level: 'strict' } })
    chats.forRun(facts({ plugins: [lint] }))
    const session = chats.get('chat-1')
    expect(session?.plugins.map(({ id }) => id)).toEqual(['lint@acme'])
    // The host knows only the user installs; the session's locations know its own.
    expect(host.ports.host.locations.pluginRoot('lint@acme')).toBe('')
    const here = sessionLocations(host, '/work/app', [lint])
    expect([here.projectDir(), here.pluginRoot('lint@acme')]).toEqual([
      '/work/app',
      '/work/app/.localix/plugins/lint',
    ])
    // Re-read with the same data, the session stays; other values open a new one.
    chats.forRun(facts({ plugins: [{ ...lint, plugin: await plugin('lint') }] }))
    expect(chats.get('chat-1')).toBe(session)
    chats.forRun(facts({ plugins: [{ ...lint, values: { level: 'loose' } }] }))
    expect(chats.get('chat-1')).not.toBe(session)
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

describe('an asyncRewake wake', () => {
  // A chat's session may first open outside a run (a typed `/skill`), with no wake to bind: the
  // wake of the latest run is the one a background hook's exit 2 reaches.
  test('reaches the wake of the latest run, not only the one the session opened with', () => {
    let deliver: ((delivered: { wake?: string }) => void) | undefined
    const { host, chats } = sessions()
    const openSession = host.kit.openSession.bind(host.kit)
    host.kit.openSession = (options) => {
      const session = openSession(options)
      session.onBackground = (listener) => {
        deliver = listener as typeof deliver
        return () => {}
      }
      return session
    }
    chats.forRun(facts())
    const woke: string[] = []
    chats.forRun(facts({ onWake: (text) => woke.push(text) }))
    deliver?.({ wake: 'tests failed' })
    expect(woke).toEqual(['tests failed'])
  })
})
