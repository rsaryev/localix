import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Message } from '../model/types'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

test('defers routine events at the anchored block without remounting text or delaying warnings', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { MessageBody } = await import('./MessageBody')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const item = {
    id: 'text',
    type: 'text' as const,
    status: 'running' as const,
    text: 'First paragraph.',
  }
  const message: Message = { id: 'reply', role: 'assistant', items: [item] }
  const notices: Message[] = [
    {
      id: 'event',
      role: 'system',
      withinMessage: { itemId: 'text', textOffset: 5 },
      createdAt: '2026-10-06T19:24:17.000Z',
      systemNotice: { kind: 'terminal_activity', tone: 'neutral', text: 'Terminal finished' },
    },
    {
      id: 'warning',
      role: 'system',
      withinMessage: { itemId: 'text', textOffset: 10 },
      systemNotice: { kind: 'hook_notice', tone: 'warning', text: 'Check the result' },
    },
  ]
  const render = async (value: Message, streaming: boolean) => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <MessageBody message={value} isUser={false} isStreaming={streaming} />
        </MemoryRouter>,
      )
    })
  }
  try {
    await render(message, true)
    const body = host.querySelector('[data-author="agent"]')!
    expect(body).not.toBeNull()
    const growing = {
      ...message,
      items: [{ ...item, text: 'First paragraph. More text.' }],
      inlineNotices: notices,
    }
    await render(growing, true)
    expect(host.querySelector('[data-author="agent"]')).toBe(body)
    expect(host.querySelectorAll('[data-author="agent"]')).toHaveLength(1)
    expect(body.textContent).toContain('First paragraph.')
    expect(body.textContent).not.toContain('Terminal finished')
    const statuses = host.querySelectorAll('[role="status"]')
    expect(statuses).toHaveLength(2)
    expect(statuses[0]!.textContent).toContain('Check the result')
    expect(statuses[1]!.textContent).toContain('1 system event received')
    expect(host.textContent).not.toContain('Terminal finished')
    expect(body.compareDocumentPosition(statuses[0]!)).toBe(4)
    const continued = {
      ...growing,
      items: [
        { ...growing.items[0]!, status: 'completed' as const },
        { ...item, id: 'next', text: 'Next block.' },
      ],
    }
    await render(continued, true)
    expect(host.textContent).toContain('Terminal finished')
    expect(host.querySelectorAll('[role="status"]')[1]).toBe(statuses[0]!)
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe(notices[0]!.createdAt!)
    expect(host.querySelectorAll('[data-author="agent"]')).toHaveLength(2)
    expect(
      host
        .querySelector('[role="status"]')!
        .compareDocumentPosition(host.querySelectorAll('[data-author="agent"]')[1]!),
    ).toBe(4)
    await render(continued, false)
    expect(host.textContent).toContain('First paragraph. More text.')
    expect(host.querySelectorAll('[data-author="agent"]')).toHaveLength(2)
    expect(host.querySelectorAll('[role="status"]')[1]).toBe(statuses[0]!)
    expect(host.textContent!.indexOf('More text.')).toBeLessThan(
      host.textContent!.indexOf('Terminal finished'),
    )
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
