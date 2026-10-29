import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The source list as the desktop build ships it.
compileLikeTheBuild(/entities\/chat\/ui\/sources\/SourceRow\.tsx$/)

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a source whose place a mini app adds after it painted can be opened', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { registerUiLocation, unregisterUiLocation } = await import('@/shared/contrib/uiLocations')
  const { SourceRow } = await import('./SourceRow')
  const uri = 'localix://ui/work-item/late-board/open'
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <SourceRow
        source={{ uri, title: 'The late board', kind: 'view' } as never}
        navigation={{ open: () => {} }}
      />,
    ),
  )
  try {
    expect(host.querySelector('button')).toBeNull()
    await act(async () =>
      registerUiLocation({
        id: 'late-board.open',
        uri,
        title: 'Open the late board',
        effect: 'read',
        surface: 'work-item',
        exposure: {},
        resolve: () => ({ kind: 'work-item', workKind: 'late-board', id: 'late', title: 'Board' }),
      }),
    )
    expect(host.querySelector('button')?.textContent).toContain('The late board')
  } finally {
    await act(async () => root.unmount())
    unregisterUiLocation('late-board.open')
  }
})
