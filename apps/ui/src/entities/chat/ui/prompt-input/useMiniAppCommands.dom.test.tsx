import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CapabilitySnapshot, MiniAppCommandSpec } from '@/shared/api/contracts'
import type { SlashCommand } from './SlashCommandMenu'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
// `backendClient` is one object for the whole run: a spy left on it is read by the next file.
afterAll(async () => {
  mock.restore()
  await teardown()
})
afterEach(async () => {
  const { __resetCapabilityCache } = await import('@/shared/contrib/capabilityCache')
  const { __resetMiniAppContrib } = await import('@/shared/contrib/enabledMiniApps')
  const { useChatStore } = await import('@/entities/chat/model/store')
  __resetCapabilityCache()
  __resetMiniAppContrib()
  useChatStore.setState({ sessions: [], allSessions: [] })
  document.body.innerHTML = ''
})

/** What the server answers for a project whose enabled mini apps declare `commands`. */
const snapshotWith = (projectId: string, commands: MiniAppCommandSpec[]) =>
  ({
    revision: 1,
    scope: { projectId, agentId: null },
    plugins: [],
    miniApps: [],
    tools: {
      enabled: [],
      disabled: [],
      catalog: [],
      categoryLabels: {},
      mcp: [],
      mcpUnprobedServers: [],
    },
    views: [],
    agents: [],
    commands: [],
    miniAppCommands: commands,
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  }) as unknown as CapabilitySnapshot

const SCOREBOARD_COMMANDS: MiniAppCommandSpec[] = [
  {
    app: 'scoreboard',
    name: 'new-game',
    fullName: 'scoreboard:new-game',
    description: 'Start a round against the agent',
    featured: true,
    args: [
      {
        name: 'side',
        type: 'choice',
        options: [{ value: 'white' }, { value: 'black', label: 'Black' }],
      },
    ],
  },
  {
    app: 'scoreboard',
    name: 'open',
    fullName: 'scoreboard:open',
    description: '',
    args: [{ name: 'game', type: 'choice', dynamic: true }],
  },
] as MiniAppCommandSpec[]

/** A conversation in project `p1`, and the commands its composer is handed. */
async function mountCommands(enabled = true) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { useChatStore } = await import('@/entities/chat/model/store')
  const { useMiniAppCommands } = await import('./useMiniAppCommands')
  const session = { id: 's1', projectId: 'p1' } as never
  useChatStore.setState({ sessions: [session], allSessions: [session] })
  const reads: Array<string | null | undefined> = []
  spyOn(backendClient, 'fetchCapabilitySnapshot').mockImplementation(async (scope) => {
    reads.push(scope?.projectId)
    return snapshotWith(scope?.projectId ?? '', SCOREBOARD_COMMANDS)
  })
  let commands: SlashCommand[] = []
  function Composer() {
    const current = useMiniAppCommands('s1', enabled)
    React.useEffect(() => {
      commands = current
    })
    return (
      <ul>
        {current.map((command) => (
          <li key={command.id}>
            /{command.trigger} — {command.description}
          </li>
        ))}
      </ul>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<Composer />))
  for (let turn = 0; turn < 10; turn++)
    await React.act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  const done = () => React.act(async () => root.unmount())
  return { host, reads, commands: () => commands, done }
}

describe('mini app commands in the composer', () => {
  test('lists the commands the project’s enabled mini apps declare, as /<app>:<command>', async () => {
    const view = await mountCommands()
    expect(view.reads).toEqual(['p1'])
    expect([...view.host.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      '/scoreboard:new-game — Start a round against the agent',
      // No description of its own: the app it comes from.
      '/scoreboard:open — From scoreboard',
    ])
    await view.done()
  })

  test('a command takes its arguments, typed after its name; a dynamic one asks the app', async () => {
    const view = await mountCommands()
    const [newGame, open] = view.commands()
    expect(newGame).toMatchObject({ prefix: '/scoreboard:new-game ', featured: true })
    expect(newGame!.args?.[0]).toMatchObject({
      name: 'side',
      type: 'choice',
      options: [
        { value: 'white', label: 'white' },
        { value: 'black', label: 'Black' },
      ],
    })
    expect(newGame!.argSource).toBeUndefined()
    expect(open!.featured).toBeUndefined()
    expect(open!.argSource).toEqual({ app: 'scoreboard', command: 'open' })
    await view.done()
  })

  test('a composer whose commands are off reads nothing and lists none', async () => {
    const view = await mountCommands(false)
    expect(view.reads).toEqual([])
    expect(view.host.querySelectorAll('li')).toHaveLength(0)
    await view.done()
  })
})
