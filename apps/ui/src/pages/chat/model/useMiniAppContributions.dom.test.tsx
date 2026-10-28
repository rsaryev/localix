import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CapabilitySnapshot, MiniAppRecord } from '@/shared/api/contracts'
import { miniAppUiHostFor } from '@/shared/contrib/host'

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

/**
 * Core UI discovery is a Vite eager glob (`import.meta.glob`), which only the bundler resolves. It
 * is the build's boundary, so the test stands in for it: discovery settles when `surfaces` says.
 */
let surfaces = Promise.withResolvers<void>()
await mock.module('@/shared/contrib/discover', () => ({
  whenUiSurfacesReady: () => surfaces.promise,
}))

const APP = 'contrib-board'
const KIND = `${APP}:board`

// The mini app's tab kind, as its UI registers it once loaded.
miniAppUiHostFor(APP).workItems.register({
  kind: KIND,
  Component: () => null,
  Icon: () => null,
  restorable: true,
  scope: 'global',
})

/** The capability document the server answers for `projectId`, with the board on or off. */
const snapshotFor = (projectId: string, enabled: boolean, revision: number) =>
  ({
    revision,
    scope: { projectId, agentId: null },
    plugins: [],
    miniApps: [{ name: APP, enabled } as MiniAppRecord],
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
    miniAppCommands: [],
    mcp: [],
    skills: [],
    tips: [],
    grammar: { kinds: [], effects: [], classes: [], examples: [] },
  }) as unknown as CapabilitySnapshot

// The stores are module-level and shared with every file that ran before this one, so they are
// reset before each test as well as after it: "unknown until the first answer" must not depend on
// what an earlier file left behind.
let restoreFetch: (() => void) | null = null
async function resetStores() {
  restoreFetch?.()
  restoreFetch = null
  const { __resetMiniAppContrib } = await import('@/shared/contrib/enabledMiniApps')
  const { useGridStore } = await import('@/entities/workspace-grid/model')
  __resetMiniAppContrib()
  useGridStore.getState().resetLayout()
  document.body.innerHTML = ''
}
beforeEach(resetStores)
afterEach(resetStores)

/** The chat page on project `p1`, with the board's tab and a file open beside it. */
async function mountChatPage(
  server: { boardEnabled: boolean },
  { discovered = true }: { discovered?: boolean } = {},
) {
  surfaces = Promise.withResolvers<void>()
  if (discovered) surfaces.resolve()
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const { useGridStore } = await import('@/entities/workspace-grid/model')
  const { useMiniAppContributions, useMiniAppContributionsSync } =
    await import('./useMiniAppContributions')
  let revision = 0
  const reads: Array<string | null | undefined> = []
  spyOn(backendClient, 'fetchCapabilitySnapshot').mockImplementation(async (scope) => {
    reads.push(scope?.projectId)
    return snapshotFor(scope?.projectId ?? '', server.boardEnabled, ++revision)
  })
  // The agent's catalog of places on screen, published for the route's project.
  const published: Array<{ projectId: string | null }> = []
  const previousFetch = globalThis.fetch
  restoreFetch = () => {
    globalThis.fetch = previousFetch
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/rpc/ui-locations/catalog') && typeof init?.body === 'string')
      published.push(JSON.parse(init.body))
    return new Response('{}', { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const grid = useGridStore.getState()
  grid.resetLayout()
  grid.openItem(
    {
      kind: 'file',
      id: 'file:keep.sql',
      title: 'keep.sql',
      scope: 's1',
      payload: { path: 'keep.sql' },
    },
    { group: 'group-root' },
  )

  const renders: Array<ReturnType<typeof useMiniAppContributions>> = []
  function ChatPage() {
    const contributions = useMiniAppContributions({ routeProjectId: 'p1', onHomeRoute: false })
    renders.push(contributions)
    useMiniAppContributionsSync({
      hasHydrated: true,
      routeProjectId: contributions.contribScope,
      thirdPartyViewsV: contributions.thirdPartyViewsV,
    })
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => root.render(<ChatPage />))
  /** Let the reads answer: event-loop turns, no waiting. */
  const turns = async () => {
    for (let turn = 0; turn < 20; turn++)
      await React.act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  }
  await turns()
  const tabs = () => Object.keys(useGridStore.getState().items).sort()
  /** The person opens the board from the rail. */
  const openBoard = () =>
    useGridStore
      .getState()
      .openItem(
        { kind: KIND, id: 'board:tab', title: 'Board', scope: '@global' },
        { group: 'group-root' },
      )
  const done = () => React.act(async () => root.unmount())
  return {
    firstRender: renders[0]!,
    seen: () => renders.at(-1)!,
    reads,
    published,
    tabs,
    openBoard,
    turns,
    done,
  }
}

describe('the chat page’s mini app contributions', () => {
  test('load for the route’s project, unknown until the first answer', async () => {
    const page = await mountChatPage({ boardEnabled: true })
    // Before the first answer the set is unknown: gates fail closed.
    expect(page.firstRender.enabledMiniAppNames).toBeNull()
    expect(page.firstRender.miniAppsPending).toBe(true)

    expect(page.reads).toEqual(['p1'])
    expect([...(page.seen().enabledMiniAppNames ?? [])]).toEqual([APP])
    expect(page.seen().miniAppsPending).toBe(false)
    expect(page.seen().contribScope).toBe('p1')
    expect(page.tabs()).toEqual(['file:keep.sql'])
    await page.done()
  })

  test('the agent’s catalog of places waits for core discovery, then names the project', async () => {
    const page = await mountChatPage({ boardEnabled: true }, { discovered: false })
    // The board's names are known, but core surfaces are not registered yet: a catalog now
    // would tell the agent about fewer places than there are.
    expect(page.seen().miniAppsPending).toBe(false)
    expect(page.published).toEqual([])
    surfaces.resolve()
    await page.turns()
    expect(page.published.map(({ projectId }) => projectId)).toEqual(['p1'])
    await page.done()
  })

  test('turning the mini app off closes its open tab and leaves the others', async () => {
    const server = { boardEnabled: true }
    const page = await mountChatPage(server)
    page.openBoard()
    expect(page.tabs()).toEqual(['board:tab', 'file:keep.sql'])

    // The toggle's `resources.changed` poke re-reads the project's document.
    server.boardEnabled = false
    const { refetchActiveMiniAppContrib } = await import('@/shared/contrib/enabledMiniApps')
    const { act } = await import('react')
    await act(async () => void (await refetchActiveMiniAppContrib()))
    await page.turns()

    expect(page.reads).toEqual(['p1', 'p1'])
    expect([...(page.seen().enabledMiniAppNames ?? [])]).toEqual([])
    expect(page.tabs()).toEqual(['file:keep.sql'])
    await page.done()
  })
})
