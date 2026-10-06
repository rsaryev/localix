import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('shortcut recorder interaction', () => {
  test('announces capture, cancels with Escape, and requires confirmation for a conflict', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ChordRecorder } = await import('./ChordRecorder')
    const recorded: Array<string | null> = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        <ChordRecorder
          chord={null}
          overridden={false}
          conflictsFor={() => ['Open file']}
          onRecord={(chord) => recorded.push(chord)}
          onUnassign={() => {}}
          onReset={() => {}}
        />,
      )
    })

    const recorder = host.querySelector<HTMLButtonElement>('[aria-label="Change shortcut"]')
    await act(async () => recorder?.click())
    expect(recorder?.getAttribute('aria-pressed')).toBe('true')
    expect(recorder?.querySelector('[role="status"]')?.textContent).toContain('Press keys')

    await act(async () => {
      for (const event of [
        new KeyboardEvent('keydown', { key: 'k', isComposing: true, bubbles: true }),
        new KeyboardEvent('keydown', { key: 'Dead', bubbles: true }),
        new KeyboardEvent('keydown', { key: 'Process', bubbles: true }),
      ])
        window.dispatchEvent(event)
      const altGraph = new KeyboardEvent('keydown', { key: '@', bubbles: true })
      Object.defineProperty(altGraph, 'getModifierState', { value: () => true })
      window.dispatchEvent(altGraph)
    })
    expect(recorder?.getAttribute('aria-pressed')).toBe('true')
    expect(recorded).toEqual([])

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(recorder?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => recorder?.click())
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
    })
    expect(host.textContent).toContain('In use by Open file')
    expect(recorded).toEqual([])

    const confirm = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Assign anyway',
    )
    await act(async () => confirm?.click())
    expect(recorded).toEqual(['j'])

    await act(async () => root.unmount())
    host.remove()
  })
})
