import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('ActionButtons', () => {
  test('keeps composer states on one accessible icon-action contract', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ActionButtons } = await import('./ActionButtons')
    const calls: string[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const base = {
      hasApiKey: true,
      onAttachClick: () => calls.push('attach'),
      onSend: () => calls.push('send'),
      onStop: () => calls.push('stop'),
      onMicClick: () => calls.push('mic'),
      onCancelRecording: () => calls.push('cancel-recording'),
    }

    try {
      await act(async () =>
        root.render(<ActionButtons {...base} hasPrompt canSend isGenerating={false} canAttach />),
      )

      const composerGroup = host.querySelector<HTMLElement>('[aria-label="Composer actions"]')!
      const send = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!
      expect(composerGroup.getAttribute('role')).toBe('group')
      expect(send.getAttribute('data-variant')).toBe('mono')
      expect(send.getAttribute('data-emphasis')).toBe('solid')
      await act(async () => send.click())
      expect(calls).toEqual(['send'])
      expect(host.querySelector('button[aria-label="Improve prompt"]')).toBeNull()
      expect(host.querySelectorAll('button')).toHaveLength(2)

      await act(async () =>
        root.render(
          <ActionButtons
            {...base}
            hasPrompt={false}
            canSend={false}
            isGenerating
            canAttach={false}
          />,
        ),
      )
      const stop = host.querySelector<HTMLButtonElement>('button[aria-label="Stop generation"]')!
      expect(stop.getAttribute('data-emphasis')).toBe('solid')
      await act(async () => stop.click())
      expect(calls).toEqual(['send', 'stop'])

      await act(async () =>
        root.render(
          <ActionButtons {...base} hasPrompt={false} canSend={false} isGenerating={false} />,
        ),
      )
      expect(host.querySelector('button[aria-label="Voice input"]')).toBeNull()
      // Nothing typed and no voice input: Send stays in its place, unavailable, so the row does
      // not jump on the first key and there is always a place that sends.
      const idleSend = host.querySelector<HTMLButtonElement>('button[aria-label="Send"]')
      expect(idleSend?.disabled).toBe(true)
      await act(async () =>
        root.render(
          <ActionButtons
            {...base}
            hasPrompt={false}
            canSend={false}
            isGenerating={false}
            canRecord
          />,
        ),
      )
      expect(host.querySelector('button[aria-label="Voice input"]')).not.toBeNull()

      await act(async () =>
        root.render(
          <ActionButtons
            {...base}
            hasPrompt={false}
            canSend={false}
            isGenerating={false}
            isRecording
            recordingSeconds={65}
          />,
        ),
      )
      expect(host.querySelector('[role="timer"]')?.getAttribute('aria-label')).toBe(
        'Recording 1:05',
      )
      expect(host.querySelector('button[aria-label="Cancel recording"]')).not.toBeNull()
      expect(host.querySelector('button[aria-label="Stop recording"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
