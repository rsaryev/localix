import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { consumeSettingsNav } from '@/shared/lib/settingsNavBus'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})
beforeEach(() => consumeSettingsNav())
afterEach(() => consumeSettingsNav())

const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

describe('warm-hidden core viewers', () => {
  test('Snapshot enables its global scroll tracker only while selected', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { MessageReplayTab } = await import('@/features/inspector/ui/MessageReplayTab')
    const { useMessageFocusStore } = await import('@/shared/lib/messageFocusBus')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')

    useMessageFocusStore.getState().setActive(false)
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <MessageReplayTab />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Surface visible={false} />))
    expect(useMessageFocusStore.getState().active).toBe(false)

    await act(async () => root.render(<Surface visible />))
    expect(useMessageFocusStore.getState().active).toBe(true)

    await act(async () => root.render(<Surface visible={false} />))
    expect(useMessageFocusStore.getState().active).toBe(false)

    await act(async () => root.unmount())
  })

  test('media bytes and plugin HTML wait for selection and stay cached while warm', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { BridgedPluginView } = await import('@/features/inspector/ui/BridgedPluginView')
    const { MediaFileTab } = await import('@/features/inspector/ui/MediaFileTab')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')

    const mediaFetch = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('hello', { headers: { 'content-type': 'text/plain' } }),
    )
    let pluginFetches = 0
    const fetchHtml = () => {
      pluginFetches++
      return Promise.resolve('<p>Plugin</p>')
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <MediaFileTab mediaId="media-1" name="note.txt" />
          <BridgedPluginView pluginName="example" viewName="panel" fetchHtml={fetchHtml} />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(mediaFetch).toHaveBeenCalledTimes(0)
    expect(pluginFetches).toBe(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(mediaFetch).toHaveBeenCalledTimes(1)
    expect(pluginFetches).toBe(1)

    await act(async () => root.render(<Surface visible={false} />))
    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(mediaFetch).toHaveBeenCalledTimes(1)
    expect(pluginFetches).toBe(1)

    await act(async () => root.unmount())
    mediaFetch.mockRestore()
  })

  test('model catalog and Settings project list stay dormant in a hidden tab', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { SWRConfig } = await import('swr')
    const { act } = React
    const { backendClient } = await import('@/shared/api/client')
    const { shellCommandApi } = await import('@/shared/api/shell-command-client')
    const { SettingsPanel } = await import('@/features/settings/ui/SettingsPanel')
    const { useModelsCatalog } = await import('@/shared/hooks/useModelsCatalog')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')

    const catalog = spyOn(backendClient, 'getCatalog').mockResolvedValue({
      models: [],
      providers: [],
      oauthProviderIds: [],
      oauthProviders: [],
    })
    const projects = spyOn(backendClient, 'listProjects').mockResolvedValue([])
    const shellStatus = spyOn(shellCommandApi, 'status').mockResolvedValue({
      available: false,
    } as never)
    function Catalog() {
      useModelsCatalog()
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <MemoryRouter>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
            <WorkItemVisibilityProvider visible={visible}>
              <Catalog />
              <SettingsPanel activeTab="system" />
            </WorkItemVisibilityProvider>
          </SWRConfig>
        </MemoryRouter>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(catalog).toHaveBeenCalledTimes(0)
    expect(projects).toHaveBeenCalledTimes(0)
    expect(shellStatus).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(catalog).toHaveBeenCalledTimes(1)
    expect(projects).toHaveBeenCalledTimes(1)
    expect(shellStatus).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    catalog.mockRestore()
    projects.mockRestore()
    shellStatus.mockRestore()
  })
})
