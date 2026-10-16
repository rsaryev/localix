import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

test('keeps the Event Center reachable after a route crash', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { createMemoryRouter, RouterProvider } = await import('react-router')
  const { resetNotificationsForTests } = await import('@/shared/lib/notifications/store')
  const { RouteErrorBoundary } = await import('./RouteErrorBoundary')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const expected = new Error('broken restored message')
  const previousConsoleError = console.error
  console.error = () => {}
  resetNotificationsForTests()

  function BrokenRoute(): never {
    throw expected
  }

  const router = createMemoryRouter([
    {
      path: '/',
      element: <BrokenRoute />,
      errorElement: <RouteErrorBoundary />,
    },
  ])

  try {
    await act(async () => root.render(<RouterProvider router={router} />))

    expect(host.textContent).toContain('This view could not load.')
    expect(host.textContent).not.toContain('broken restored message')
    expect(host.querySelector('button[aria-label^="Event Center"]')).not.toBeNull()

    const details = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Details',
    )
    expect(details).not.toBeUndefined()
    await act(async () => {
      details?.click()
      await import('@/shared/ui/notification-center/NotificationCenter')
    })

    expect(document.querySelector('[role="dialog"][aria-label="Event Center"]')).not.toBeNull()
  } finally {
    console.error = previousConsoleError
    await act(async () => root.unmount())
    host.remove()
    resetNotificationsForTests()
  }
})
