import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The file tab's viewer routing as the desktop build ships it.
compileLikeTheBuild(/features\/inspector\/ui\/useDocumentContentType\.ts$/)

const OWNER = 'viewer-fixture'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('an open file hands over to a document viewer a mini app adds after it painted', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { miniAppUiHostFor, removeMiniAppUiContributions } = await import('@/shared/contrib/host')
  const { setEnabledMiniAppNames } = await import('@/shared/contrib/miniAppActivation')
  const { flushRegistryChanges } = await import('@/shared/contrib/registryChanges')
  const { useDocumentContentType } = await import('./useDocumentContentType')
  function Tab() {
    return <p>{useDocumentContentType('/work/report.late') ?? 'editor'}</p>
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Tab />))
  try {
    expect(host.textContent).toBe('editor')
    await act(async () => {
      setEnabledMiniAppNames(new Set([OWNER]))
      miniAppUiHostFor(OWNER).fileFormats.register({
        late: { contentType: 'application/x-late', viewer: 'pdf', openExternally: true },
      })
      flushRegistryChanges()
    })
    expect(host.textContent).toBe('application/x-late')
  } finally {
    await act(async () => root.unmount())
    removeMiniAppUiContributions(OWNER)
    flushRegistryChanges()
    setEnabledMiniAppNames(null)
  }
})
