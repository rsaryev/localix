import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '../testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('OpponentMenu', () => {
  test('names the current opponent and offers the other one under its heading', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { OpponentMenu } = await import('./opponent-menu')
    const onChange = mock((_opponent: string) => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(<OpponentMenu value="agent" heading="Who plays O" onChange={onChange} />),
    )
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Opponent: Chat agent"]')
      expect(trigger?.textContent).toContain('Chat agent')
      await act(async () => {
        trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
      expect(document.body.textContent).toContain('Who plays O')
      const items = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
      const decision = items.find((item) => item.textContent?.includes('Decision model'))
      expect(decision).toBeDefined()
      await act(async () => decision!.click())
      expect(onChange).toHaveBeenCalledWith('decision')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
