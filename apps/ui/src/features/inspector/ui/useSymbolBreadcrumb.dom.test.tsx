import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { backendClient } from '@/shared/api/client'
import type { LspDocumentSymbol } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'
import { WorkItemVisibilityProvider } from '@localixai/mini-app-sdk/ui/visibility'
import { useSymbolBreadcrumb } from './useSymbolBreadcrumb'
import { turns } from '@/testing/settle'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('refreshes unsaved symbol positions, discards stale replies, and suspends hidden tabs', async () => {
  const { useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const pending: ((symbols: LspDocumentSymbol[]) => void)[] = []
  const request = spyOn(backendClient, 'lspDocumentSymbols').mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  )
  let snapshot: ReturnType<typeof useSymbolBreadcrumb> | undefined
  function Harness({ buffer }: { buffer: string }) {
    const value = useSymbolBreadcrumb('session', '/workspace/main.ts', 'same-saved-hash', buffer, 0)
    useEffect(() => {
      snapshot = value
    })
    return null
  }
  const render = (buffer: string, visible = true) =>
    act(async () =>
      root.render(
        <WorkItemVisibilityProvider visible={visible}>
          <Harness buffer={buffer} />
        </WorkItemVisibilityProvider>,
      ),
    )
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await turns()
    })
  const symbol = (line: number): LspDocumentSymbol => ({
    name: 'run',
    kind: 12,
    line,
    character: 0,
    endLine: line + 2,
    depth: 0,
  })
  try {
    await render('function run() {}')
    await settle()
    expect(request).toHaveBeenCalledTimes(1)
    await render('\nfunction run() {}')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    await act(async () => pending[1]!([symbol(1)]))
    await act(async () => pending[0]!([symbol(0)]))
    expect(snapshot!.docSymbols[0]!.line).toBe(1)
    await render('\n\nfunction run() {}', false)
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    await render('\n\nfunction run() {}')
    await settle()
    expect(request).toHaveBeenCalledTimes(3)
  } finally {
    await act(async () => root.unmount())
    request.mockRestore()
  }
})
