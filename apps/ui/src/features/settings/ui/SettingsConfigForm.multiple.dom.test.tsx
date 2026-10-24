import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ConfigFormField } from './SettingsConfigForm'

/**
 * A plugin option declared `multiple` takes a list of strings: the form shows one item per line
 * and saves the lines as the JSON array the API stores (`plugins/config-lists.ts`).
 */

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 0))
  await teardown()
})

const roots: ConfigFormField = {
  key: 'roots',
  title: 'Roots',
  type: 'string',
  description: 'Folders to index, one per line',
  required: false,
  secret: false,
  multiple: true,
  value: JSON.stringify(['src', 'docs']),
  isSet: true,
}

describe('a multiple option in the plugin settings form', () => {
  test('shows its items one per line and saves the edited lines as a list', async () => {
    const [{ SettingsConfigForm }, React, { createRoot }, { act }] = await Promise.all([
      import('./SettingsConfigForm'),
      import('react'),
      import('react-dom/client'),
      import('react'),
    ])
    const saved: Record<string, unknown>[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        React.createElement(SettingsConfigForm, {
          fields: [roots],
          busy: false,
          onSave: (values) => saved.push(values),
        }),
      )
    })
    try {
      const area = host.querySelector('textarea')!
      expect(area.value).toBe('src\ndocs')
      expect(host.querySelector('label')?.htmlFor).toBe(area.id)
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )!.set!
        setValue.call(area, 'lib\n\n web \n')
        area.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => host.querySelector('button')!.click())
      expect(saved).toEqual([{ roots: JSON.stringify(['lib', 'web']) }])
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
