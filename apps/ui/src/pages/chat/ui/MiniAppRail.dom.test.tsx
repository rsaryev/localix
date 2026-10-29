import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The page's mini app slots as the desktop build ships them.
compileLikeTheBuild(/pages\/chat\/ui\/MiniAppRail\.tsx$/)

const OWNER = 'rail-fixture'
const None = () => null

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())
afterEach(async () => {
  const { removeMiniAppUiContributions } = await import('@/shared/contrib/host')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  const { flushRegistryChanges } = await import('@/shared/contrib/registryChanges')
  removeMiniAppUiContributions(OWNER)
  flushRegistryChanges()
  setEnabledMiniAppNames(null)
})

async function mount(node: React.ReactNode) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, act, unmount: () => act(async () => root.unmount()) }
}

/** A mini app whose UI loads after the page painted: an install, an enable. */
async function installLate(contribute: (host: MiniAppUiHost) => void) {
  const { miniAppUiHostFor } = await import('@/shared/contrib/host')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  const { flushRegistryChanges } = await import('@/shared/contrib/registryChanges')
  setEnabledMiniAppNames(new Set([OWNER]))
  contribute(miniAppUiHostFor(OWNER))
  flushRegistryChanges()
}

test('a mini app installed while the page is open gets its rail section', async () => {
  const { useContributedRailSections } = await import('./MiniAppRail')
  function Rail() {
    return (
      <ul>
        {useContributedRailSections('').map((s) => (
          <li key={s.id}>{s.label}</li>
        ))}
      </ul>
    )
  }
  const view = await mount(<Rail />)
  try {
    expect(view.host.textContent).not.toContain('Boards')
    await view.act(() =>
      installLate((host) =>
        host.railSections.register({
          id: `${OWNER}:section`,
          title: 'Boards',
          Icon: None,
          Sidebar: None,
        }),
      ),
    )
    expect(view.host.textContent).toContain('Boards')
  } finally {
    await view.unmount()
  }
})

test('a mini app installed while the page is open starts its background work', async () => {
  const { MiniAppBackgroundMounts } = await import('./MiniAppRail')
  const view = await mount(<MiniAppBackgroundMounts />)
  try {
    expect(view.host.textContent).not.toContain('watching boards')
    await view.act(() =>
      installLate((host) =>
        host.railViewlets.register({
          kind: `${OWNER}:viewlet`,
          title: 'Boards',
          label: 'Boards',
          Icon: None,
          defaultArea: 'bar',
          Mount: () => <p>watching boards</p>,
        }),
      ),
    )
    expect(view.host.textContent).toContain('watching boards')
  } finally {
    await view.unmount()
  }
})
