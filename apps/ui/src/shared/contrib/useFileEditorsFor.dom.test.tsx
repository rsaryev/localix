import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The open file tab's routing as the desktop build ships it.
compileLikeTheBuild(/shared\/contrib\/useFileEditorsFor\.ts$/)

const OWNER = 'table-fixture'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('an open file takes the editor of a mini app installed while it is open', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { miniAppUiHostFor, removeMiniAppUiContributions } = await import('./host')
  const { setEnabledMiniAppNames } = await import('./miniAppActivation')
  const { flushRegistryChanges } = await import('./registryChanges')
  const { useFileEditorsFor } = await import('./useFileEditorsFor')
  function Tab() {
    const editors = useFileEditorsFor('/work/statement.csv')
    return <p>{editors.map((editor) => editor.label).join(', ') || 'Code editor'}</p>
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Tab />))
  try {
    expect(host.textContent).toBe('Code editor')
    await act(async () => {
      setEnabledMiniAppNames(new Set([OWNER]))
      miniAppUiHostFor(OWNER).fileEditors.register({
        id: `${OWNER}:table`,
        label: 'Table view',
        match: (path) => path.endsWith('.csv'),
        Component: () => null,
      })
      flushRegistryChanges()
    })
    expect(host.textContent).toBe('Table view')
  } finally {
    await act(async () => root.unmount())
    removeMiniAppUiContributions(OWNER)
    flushRegistryChanges()
    setEnabledMiniAppNames(null)
  }
})
