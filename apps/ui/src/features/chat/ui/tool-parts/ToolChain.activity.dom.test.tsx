import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Message } from '../../model/types'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

const event = (
  id: string,
  text: string,
  state: 'running' | 'completed' = 'completed',
): Message => ({
  id,
  role: 'system',
  systemNotice: {
    kind: 'terminal_activity',
    tone: 'neutral',
    text,
    activity: { id: 'pty', state },
  },
})

describe('quiet activity in action blocks', () => {
  test('a finished activity block is collapsed and reveals its ordered deduplicated details on demand', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <ToolChain
            items={[]}
            activity={[
              event('first', 'Interacted'),
              event('second', 'Interacted'),
              event('waited', 'Waited'),
              event('third', 'Interacted'),
              event('finished', 'Finished'),
            ]}
            isLatest
          />,
        ),
      )
      const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(host.textContent).not.toContain('Interacted')
      expect(host.textContent).not.toContain('Waited')
      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect([...host.querySelectorAll('[role="status"]')].map((line) => line.textContent)).toEqual(
        ['Interacted ×2', 'Waited', 'Interacted', 'Finished'],
      )
      expect(host.querySelector('time')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('live activity settles in the same disclosure and manual expansion survives the result', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { ToolChain } = await import('./ToolChain')
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <ToolChain items={[]} activity={[event('wait', 'Waiting', 'running')]} isLatest />,
        ),
      )
      const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      await act(async () =>
        root.render(<ToolChain items={[]} activity={[event('wait', 'Waited')]} isLatest />),
      )
      expect(host.querySelector('button[aria-expanded]')).toBe(toggle)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.nextElementSibling?.getAttribute('aria-hidden')).toBe('true')
      await act(async () => toggle.click())
      await act(async () =>
        root.render(<ToolChain items={[]} activity={[event('finished', 'Finished')]} isLatest />),
      )
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(host.textContent).toContain('Finished')
    } finally {
      await act(async () => root.unmount())
    }
  })
})
