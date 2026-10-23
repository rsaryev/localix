import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('an unreadable object’s DDL says why and retries instead of spinning forever', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { DdlPreviewDialog } = await import('./DdlPreviewDialog')
  const retried: string[] = []
  const reader = {
    getTable: () => undefined,
    getTableError: () => 'permission denied for table orders',
    getTableErrorDetail: () => undefined,
    reloadTable: (table: string) => {
      retried.push(table)
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => {
      root.render(
        <DdlPreviewDialog
          target={{ connectionId: 'c', table: 'orders' }}
          reader={reader}
          dialect="postgres"
          onClose={() => {}}
        />,
      )
    })
    expect(document.body.textContent).toContain('permission denied for table orders')
    const retry = [...document.body.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Retry'),
    )
    await act(async () => retry?.click())
    expect(retried).toEqual(['orders'])
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
