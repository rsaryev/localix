import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolCallItem } from '@localixai/agent/agents'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

const item = (status: ToolCallItem['status'], resultText?: string): ToolCallItem => ({
  id: 'preview-1',
  type: 'tool_call',
  status,
  toolCallId: 'tc-preview-1',
  name: 'browser',
  input: { action: 'evaluate', expression: 'window.board' },
  activeVerb: 'evaluating',
  resultText,
})

describe('BrowserCard DOM runtime', () => {
  test('settles a long streaming result into the bounded output surface without runtime errors', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { BrowserCard } = await import('./BrowserCard')
    const host = document.createElement('div')
    host.style.width = '320px'
    document.body.append(host)
    const root = createRoot(host)
    const errors: unknown[][] = []
    const previousError = console.error
    console.error = (...args: unknown[]) => errors.push(args)

    try {
      await act(async () => root.render(<BrowserCard item={item('running')} />))
      const longOutput = Array.from({ length: 20_000 }, (_, index) => `line ${index}`).join('\n')
      await act(async () => root.render(<BrowserCard item={item('completed', longOutput)} />))
      await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click())

      const output = host.querySelector('pre')!
      expect(output.className).toContain('max-h-64')
      expect(output.className).toContain('overflow-auto')
      expect(output.textContent).toContain('line 19999')
      expect(output.textContent!.length).toBeLessThan(longOutput.length)
      expect(errors).toEqual([])
    } finally {
      console.error = previousError
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('an expanded screenshot shows the picture the agent received, not `[image]`', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { BrowserCard } = await import('./BrowserCard')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const shot: ToolCallItem = {
      ...item('completed', 'Screenshot (4×4).'),
      input: { action: 'take_screenshot' },
      attachments: [
        { kind: 'image', mediaType: 'image/png', mediaId: 'abc.png', name: 'image-1', size: 3 },
      ],
    }
    try {
      await React.act(async () => root.render(<BrowserCard item={shot} />))
      await React.act(async () =>
        host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click(),
      )
      expect(host.querySelector('img')?.getAttribute('src')).toContain('/rpc/media/abc.png')
      expect(host.textContent).not.toContain('[image]')
    } finally {
      await React.act(async () => root.unmount())
      host.remove()
    }
  })
})
