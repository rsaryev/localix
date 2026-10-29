import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The palette's commands as the desktop build ships them.
compileLikeTheBuild(/shared\/contrib\/useUiLocationCommands\.ts$/)

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

test('a place a mini app adds while the palette is up is offered in it', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { registerUiLocation, unregisterUiLocation } = await import('./uiLocations')
  const { useUiLocationCommands } = await import('./useUiLocationCommands')
  function Palette() {
    return (
      <ul>
        {useUiLocationCommands(null).map((command) => (
          <li key={command.id}>{command.label}</li>
        ))}
      </ul>
    )
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Palette />
      </MemoryRouter>,
    ),
  )
  try {
    expect(host.textContent).not.toContain('Open the late board')
    await act(async () =>
      registerUiLocation({
        id: 'late-board.open',
        uri: 'localix://ui/work-item/late-board/open',
        title: 'Open the late board',
        effect: 'read',
        surface: 'work-item',
        exposure: { palette: true },
        resolve: () => ({ kind: 'work-item', workKind: 'late-board', id: 'late', title: 'Board' }),
      }),
    )
    expect(host.textContent).toContain('Open the late board')
  } finally {
    await act(async () => root.unmount())
    unregisterUiLocation('late-board.open')
  }
})
