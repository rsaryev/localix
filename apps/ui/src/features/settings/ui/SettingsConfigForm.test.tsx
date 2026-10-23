import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ConfigFormField } from './SettingsConfigForm'

/**
 * `docs/extending/plugins.md` documents `title` as "the human-readable label shown in the
 * Settings UI". That was FALSE: SettingsConfigForm always rendered `{f.key}` and never read
 * `f.title`, so plugin authors wrote titles that went nowhere — the same "advertised, does
 * nothing" class as `multiple`, but here a genuine fix (the value already rides the wire —
 * PluginConfigField.title, populated in plugins/service-types.ts).
 *
 * This renders the REAL component and reads the DOM: a field with a title must show the
 * title and associate that visible label to its control; a field without one must fall
 * back to the key, never blank. Revert to `{f.key}` and the "shows the title" case fails.
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

const field = (over: Partial<ConfigFormField>): ConfigFormField => ({
  key: 'API_KEY',
  type: 'string',
  description: '',
  required: false,
  secret: false,
  value: null,
  isSet: false,
  ...over,
})

async function render(fields: ConfigFormField[], busy = false) {
  const [{ SettingsConfigForm }, React, { createRoot }, { act }] = await Promise.all([
    import('./SettingsConfigForm'),
    import('react'),
    import('react-dom/client'),
    import('react'),
  ])
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(SettingsConfigForm, { fields, busy, onSave: () => {} }))
  })
  return {
    host,
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('SettingsConfigForm renders the field title, keyed fallback', () => {
  test('a field WITH a title shows the title as its label and accessible name', async () => {
    const { host, cleanup } = await render([field({ key: 'API_KEY', title: 'Service API key' })])
    try {
      expect(host.querySelector('label')?.textContent ?? '').toContain('Service API key')
      // The key must NOT be what the user sees when a title is declared.
      expect(host.querySelector('label')?.textContent ?? '').not.toContain('API_KEY')
      const label = host.querySelector('label')
      const input = host.querySelector('input')
      expect(label?.htmlFor).toBe(input?.id)
      expect(input?.id).not.toBe('')
    } finally {
      await cleanup()
    }
  })

  test('a field WITHOUT a title falls back to the key — never blank', async () => {
    const { host, cleanup } = await render([field({ key: 'MAX_ITEMS' })])
    try {
      const labelText = host.querySelector('label')?.textContent ?? ''
      expect(labelText).toContain('MAX_ITEMS')
      expect(labelText.trim()).not.toBe('')
      expect(host.querySelector('label')?.htmlFor).toBe(host.querySelector('input')?.id)
    } finally {
      await cleanup()
    }
  })

  test('an empty-string title still falls back to the key (never a blank label)', async () => {
    // `?? ` keeps '' — but a blank label is meaningless; the key must win. Guard the
    // exact edge the task called out.
    const { host, cleanup } = await render([field({ key: 'TOKEN', title: '' })])
    try {
      expect(host.querySelector('label')?.textContent).toContain('TOKEN')
      expect(host.querySelector('label')?.htmlFor).toBe(host.querySelector('input')?.id)
    } finally {
      await cleanup()
    }
  })

  test('saving uses the shared settings activity signal without legacy ellipsis', async () => {
    const { host, cleanup } = await render([field({ key: 'TOKEN' })], true)
    try {
      const button = host.querySelector('button')
      expect(button?.getAttribute('aria-busy')).toBe('true')
      expect(button?.textContent).toContain('Saving config')
      expect(button?.textContent).not.toContain('…')
      expect(host.querySelector('input')?.disabled).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test('an enum field is a labelled combobox showing the current choice', async () => {
    const { host, cleanup } = await render([
      field({ key: 'REGION', enum: [{ value: 'eu', label: 'Europe' }], value: 'eu' }),
    ])
    try {
      const controlId = host.querySelector('label')?.htmlFor
      const trigger = controlId
        ? host.querySelector<HTMLButtonElement>(`button[id="${controlId}"]`)
        : null
      expect(trigger?.textContent).toContain('Europe')
      expect(trigger?.getAttribute('role')).toBe('combobox')
      expect(trigger?.getAttribute('aria-autocomplete')).toBe('none')
    } finally {
      await cleanup()
    }
  })

  test('a boolean field is a switch tied to its label, not a true/false list', async () => {
    const { host, cleanup } = await render([
      field({ key: 'ENABLED', title: 'Enabled', type: 'boolean', value: true }),
    ])
    try {
      const control = host.querySelector<HTMLInputElement>('input[role="switch"]')
      expect(control?.checked).toBe(true)
      expect(host.querySelector('label')?.htmlFor).toBe(control?.id)
      expect(host.querySelector('[role="combobox"]')).toBeNull()
    } finally {
      await cleanup()
    }
  })

  test('an enum option carries what the server says it means', async () => {
    // The wire sends `enum[].description`; the picker used to drop it on the floor.
    const { act } = await import('react')
    const { host, cleanup } = await render([
      field({
        key: 'REGION',
        enum: [{ value: 'eu', label: 'Europe', description: 'Data stays in the EU' }],
        value: 'eu',
        required: true,
      }),
    ])
    try {
      const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!
      await act(async () => {
        trigger.focus()
        trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 30))
      })
      const option = document.querySelector('[role="option"]')
      expect(option?.textContent).toContain('Data stays in the EU')
    } finally {
      await cleanup()
    }
  })

  test('associates manifest help text through aria-describedby without inflating the label', async () => {
    const { host, cleanup } = await render([
      field({ key: 'TIMEOUT', title: 'Timeout', description: 'Maximum wait in seconds' }),
    ])
    try {
      const input = host.querySelector('input')
      const descriptionId = input?.getAttribute('aria-describedby')
      expect(descriptionId).not.toBeNull()
      expect(host.querySelector(`[id="${descriptionId}"]`)?.textContent).toContain(
        'Maximum wait in seconds',
      )
      expect(host.querySelector('label')?.textContent).toBe('Timeout')
    } finally {
      await cleanup()
    }
  })
})
