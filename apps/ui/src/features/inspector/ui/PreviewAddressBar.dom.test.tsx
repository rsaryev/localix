import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { useBrowserHistory } from '../model/browserHistory'
import { PreviewAddressBar } from './PreviewAddressBar'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

test('opens address suggestions immediately on focus', async () => {
  const { createRoot } = await import('react-dom/client')
  const oldVisits = useBrowserHistory.getState().visits
  useBrowserHistory.setState({
    visits: [{ url: 'https://example.com/', title: 'Example', visitedAt: 1 }],
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const props = {
    url: 'https://openai.com/',
    onNavigate: () => {},
    onReload: () => {},
  }
  try {
    await act(async () => root.render(<PreviewAddressBar {...props} />))
    const address = container.querySelector<HTMLInputElement>('[aria-label="Browser address"]')
    await act(async () => address?.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(address?.getAttribute('aria-expanded')).toBe('true')
    expect(
      document.body.querySelector('[data-slot="autocomplete-list"][data-state="open"]'),
    ).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    useBrowserHistory.setState({ visits: oldVisits })
  }
})
