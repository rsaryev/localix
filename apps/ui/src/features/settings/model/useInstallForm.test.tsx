import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { InstallForm } from './useInstallForm'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('useInstallForm enable default', () => {
  test('an explicitly installed plugin starts enabled and resets to that default', async () => {
    const [{ useInstallForm }, React, { createRoot }, { act }] = await Promise.all([
      import('./useInstallForm'),
      import('react'),
      import('react-dom/client'),
      import('react'),
    ])
    const installs: Array<[string, boolean]> = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let form: InstallForm | null = null

    function Probe() {
      form = useInstallForm({
        install: async (source, enable) => {
          installs.push([source, enable])
        },
        refresh: () => {},
        defaultEnable: true,
      })
      return null
    }

    try {
      await act(async () => root.render(React.createElement(Probe)))
      expect(form!.installEnable).toBe(true)

      act(() => {
        form!.setSource('  owner/plugin  ')
        form!.setInstallEnable(false)
      })
      expect(form!.installEnable).toBe(false)

      act(() => form!.setInstallEnable(true))
      await act(async () => {
        await form!.submit()
      })

      expect(installs).toEqual([['owner/plugin', true]])
      expect(form!.source).toBe('')
      expect(form!.installEnable).toBe(true)
      expect(form!.error).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
