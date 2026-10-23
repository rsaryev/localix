import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { DOCUMENT_SYMBOL_OVERLAY_ID } from './GoToSymbol.surface'
import { WORKSPACE_SYMBOL_OVERLAY_ID } from './WorkspaceSymbols.surface'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

type Palette = (props: {
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) => React.ReactNode

const palettes: [string, string, () => Promise<Palette>][] = [
  ['GoToSymbol', DOCUMENT_SYMBOL_OVERLAY_ID, async () => (await import('./GoToSymbol')).GoToSymbol],
  [
    'WorkspaceSymbols',
    WORKSPACE_SYMBOL_OVERLAY_ID,
    async () => (await import('./WorkspaceSymbols')).WorkspaceSymbols,
  ],
]

describe.each(palettes)('%s overlay query', (_name, overlayId, load) => {
  test('opens from the overlay bus with its query, and a plain reopen starts empty', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { openUiOverlay } = await import('@/shared/lib/uiOverlayBus')
    const Palette = await load()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onOpenChange = mock()
    const render = (open: boolean) =>
      act(async () =>
        root.render(<Palette sessionId={null} open={open} onOpenChange={onOpenChange} />),
      )
    const input = () => document.body.querySelector<HTMLInputElement>('[cmdk-input]')

    await render(false)
    expect(input()).toBeNull()
    await act(async () => openUiOverlay(overlayId, { query: 'useFoo' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    await render(true)
    expect(input()?.value).toBe('useFoo')

    // Already open: a second request replaces the query in place.
    await act(async () => openUiOverlay(overlayId, { query: 'Bar' }))
    expect(input()?.value).toBe('Bar')

    await render(false)
    await render(true)
    expect(input()?.value).toBe('')

    await act(async () => root.unmount())
    host.remove()
  })
})
