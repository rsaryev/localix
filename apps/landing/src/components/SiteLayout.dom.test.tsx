import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

void mock.module('./Button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props} />
  ),
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  })
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => {} })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  })
})

afterAll(async () => {
  mock.restore()
  await GlobalRegistrator.unregister()
})

test('focuses cold and same-route fragments, then returns focus to main from the footer', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { Link, MemoryRouter, Route, Routes } = await import('react-router')
  const { SiteLayout } = await import('./SiteLayout')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/#demo']}>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route
              index
              element={
                <>
                  <Link to="/#details">Open details</Link>
                  <section id="demo">Inspectable task pipeline</section>
                  <section id="details">Product details</section>
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  expect(document.activeElement).toBe(document.getElementById('demo'))

  const details = Array.from(host.querySelectorAll('a')).find(
    (link) => link.textContent?.trim() === 'Open details',
  )
  expect(details).toBeDefined()
  await act(async () => {
    details?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(document.activeElement).toBe(document.getElementById('details'))

  const backToTop = Array.from(host.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Back to top',
  )
  expect(backToTop).toBeDefined()
  await act(async () => backToTop?.click())
  expect(document.activeElement).toBe(document.getElementById('main-content'))

  await act(async () => root.unmount())
  host.remove()
})
