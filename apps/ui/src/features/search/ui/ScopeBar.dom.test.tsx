import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The scope pills as the desktop build ships them.
compileLikeTheBuild(/features\/search\/ui\/ScopeBar\.tsx$/)

const OWNER = 'scope-fixture'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a mini app enabled while search is open adds its scope', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { miniAppUiHostFor, removeMiniAppUiContributions } = await import('@/shared/contrib/host')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  const { flushRegistryChanges } = await import('@/shared/contrib/registryChanges')
  const { ALL_SCOPE } = await import('../model/scopes')
  const { ScopeBar } = await import('./ScopeBar')
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<ScopeBar scope={ALL_SCOPE} onPick={() => {}} />))
  try {
    expect(host.textContent).not.toContain('Boards')
    await act(async () => {
      setEnabledMiniAppNames(new Set([OWNER]))
      miniAppUiHostFor(OWNER).search.register({
        id: `${OWNER}:boards`,
        icons: {},
        scope: { label: 'Boards', prefix: 'board', icon: 'board' },
      })
      flushRegistryChanges()
    })
    expect(host.textContent).toContain('Boards')
  } finally {
    await act(async () => root.unmount())
    removeMiniAppUiContributions(OWNER)
    flushRegistryChanges()
    setEnabledMiniAppNames(null)
  }
})
