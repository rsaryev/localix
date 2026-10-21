import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('warm-hidden core work-item data sources', () => {
  test('a parked definition peek waits to read its target file', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { usePeekDefinition } = await import('@/features/inspector/ui/usePeekDefinition')

    const read = spyOn(backendClient, 'getFileContent').mockImplementation(
      () => new Promise(() => {}),
    )
    // The read is the TAB's, not the panel's — the panel unmounts when the peek closes, and a
    // problem owner that unmounts can never settle its Event Center row. So the hook is what has
    // to honour warm-hidden.
    function Peek() {
      usePeekDefinition('session-1', { file: 'src/target.ts', line: 4 })
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Peek />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(read).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(read).toHaveBeenCalledTimes(1)

    await act(async () => root.render(<Surface visible={false} />))
    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(read).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    read.mockRestore()
  })

  test('usage dashboard reads wait for the Stats work item to become visible', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { SWRConfig } = await import('swr')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { useUsageKeys, useUsageLogs, useUsageOverview } =
      await import('@/shared/hooks/useUsageStats')

    const overview = spyOn(backendClient, 'getUsageOverview').mockResolvedValue({
      summary: {},
      stats: [],
      trend: [],
    } as never)
    const keys = spyOn(backendClient, 'getUsageKeys').mockResolvedValue({
      models: [],
      providers: [],
      sessions: [],
      agents: [],
    })
    const logs = spyOn(backendClient, 'getUsageLogs').mockResolvedValue({
      rows: [],
      nextCursor: null,
    })

    function Dashboard() {
      useUsageKeys()
      useUsageOverview('30d', 'model', 1_700_000_000_000, {})
      useUsageLogs('30d', 1_700_000_000_000, {})
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <WorkItemVisibilityProvider visible={visible}>
            <Dashboard />
          </WorkItemVisibilityProvider>
        </SWRConfig>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect([overview.mock.calls.length, keys.mock.calls.length, logs.mock.calls.length]).toEqual([
      0, 0, 0,
    ])

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect([overview.mock.calls.length, keys.mock.calls.length, logs.mock.calls.length]).toEqual([
      1, 1, 1,
    ])

    await act(async () => root.unmount())
    overview.mockRestore()
    keys.mockRestore()
    logs.mockRestore()
  })

  test('global search preserves its query but sends nothing while its tab is hidden', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { searchApi } = await import('@/features/search/api/searchApi')
    const { useGlobalSearch } = await import('@/features/search/model/useGlobalSearch')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')

    const search = spyOn(searchApi, 'search').mockResolvedValue({
      groups: [],
      hits: [],
      total: 0,
      strategy: { mode: 'lexical' },
    })
    function Search() {
      useGlobalSearch({ initialQuery: 'alpha', debounceMs: 0 })
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Search />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(search).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(search).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    search.mockRestore()
  })

  test('seeded review lists start only when selected', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { useSeededLiveList } = await import('@/entities/chat/model/useSeededLiveList')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')

    const seedCalls: string[] = []
    const fetchList = (sessionId: string) => {
      seedCalls.push(sessionId)
      return Promise.resolve<string[]>([])
    }
    function ReviewSeed() {
      useSeededLiveList('session-1', undefined, fetchList)
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <ReviewSeed />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(seedCalls).toEqual([])

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(seedCalls).toEqual(['session-1'])

    await act(async () => root.unmount())
  })
})
