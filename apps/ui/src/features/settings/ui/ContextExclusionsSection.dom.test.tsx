import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

async function mount() {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useUserSettings } = await import('../model/useUserSettings')
  const { ContextExclusionsSection } = await import('./ContextExclusionsSection')
  const previous = useUserSettings.getState()
  useUserSettings.setState({
    settings: {
      uiSettings: {},
      agentSettings: { contextExclusions: ['generated'], research: { allowPrivate: true } },
    },
  })
  const update = spyOn(useUserSettings.getState(), 'update').mockImplementation(() => {})
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ContextExclusionsSection />))
  const textarea = host.querySelector('textarea')!
  const apply = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Apply exclusions',
  )!
  return {
    host,
    apply,
    update,
    type: async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(
          textarea,
          value,
        )
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }),
    click: async () => act(async () => apply.click()),
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
      update.mockRestore()
      useUserSettings.setState(previous, true)
    },
  }
}

describe('context exclusions editor', () => {
  test('invalid paths cannot be applied and expose an accessible error', async () => {
    const form = await mount()
    try {
      for (const path of ['/private', '../private', 'private\\local']) {
        await form.type(path)
        expect(form.apply.disabled).toBe(true)
        expect(form.host.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true')
        expect(form.host.querySelector('[role="alert"]')).not.toBeNull()
        await form.click()
      }
      expect(form.update).not.toHaveBeenCalled()
    } finally {
      await form.cleanup()
    }
  })

  test('trims and deduplicates paths while preserving other runtime settings', async () => {
    const form = await mount()
    try {
      expect(form.apply.disabled).toBe(true)
      await form.type(' generated \nprivate/local\n\nprivate/local ')
      expect(form.apply.disabled).toBe(false)
      await form.click()
      expect(form.update).toHaveBeenCalledWith({
        agentSettings: {
          contextExclusions: ['generated', 'private/local'],
          research: { allowPrivate: true },
        },
      })
      await form.type('')
      await form.click()
      expect(form.update).toHaveBeenLastCalledWith({
        agentSettings: { contextExclusions: [], research: { allowPrivate: true } },
      })
    } finally {
      await form.cleanup()
    }
  })
})
