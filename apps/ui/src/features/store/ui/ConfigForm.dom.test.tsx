import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { isPrimaryModifier } from '@localixai/kit/keybindings'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ConfigValue, ListingConfig } from '@localixai/store'
import { ConfigForm } from './ConfigForm'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const CONFIG: ListingConfig = {
  fields: [
    {
      key: 'url',
      label: 'Service URL',
      help: 'Where it runs',
      type: 'string',
      required: true,
      secret: false,
    },
    {
      key: 'level',
      label: 'Level',
      type: 'number',
      required: false,
      secret: false,
      min: 1,
      max: 9,
    },
    { key: 'verbose', label: 'Verbose', type: 'boolean', required: false, secret: false },
    {
      key: 'mode',
      label: 'Mode',
      type: 'choice',
      required: false,
      secret: false,
      options: [{ value: 'fast' }, { value: 'safe', label: 'Safe', description: 'Slower' }],
    },
    {
      key: 'tags',
      label: 'Tags',
      help: 'One per line',
      type: 'list',
      required: false,
      secret: false,
    },
    { key: 'token', label: 'API token', type: 'string', required: false, secret: true },
  ],
  values: { url: 'https://a.test', level: 3, verbose: false, mode: 'fast', tags: ['a', 'b'] },
  set: ['token'],
  scope: 'user',
  scopes: ['user'],
}

async function render(
  config: ListingConfig = CONFIG,
  onSave: (values: Record<string, ConfigValue>) => Promise<void> = async () => {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(host)
  await act(async () => root.render(<ConfigForm config={config} onSave={onSave} />))
  /** A control by its visible label, the way a person finds it. */
  const field = (label: string) => {
    const found = [...host.querySelectorAll('label')].find((node) =>
      node.textContent?.startsWith(label),
    )
    return found ? host.querySelector<HTMLInputElement>(`#${CSS.escape(found.htmlFor)}`) : null
  }
  const button = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (node) => node.textContent?.trim() === name,
    )
  const type = (input: HTMLInputElement | HTMLTextAreaElement | null, value: string) =>
    act(async () => {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(input, value)
      input!.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const click = (element: Element | undefined) => act(async () => (element as HTMLElement).click())
  const save = (at: Element = host) =>
    act(async () => {
      // The primary key of whichever OS the test runs on: Cmd on a Mac, Ctrl elsewhere.
      const primary = isPrimaryModifier({ metaKey: true, ctrlKey: false })
        ? { metaKey: true }
        : { ctrlKey: true }
      at.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ...primary, bubbles: true, cancelable: true }),
      )
    })
  return {
    host,
    field,
    button,
    type,
    click,
    save,
    done: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('the configuration form', () => {
  test('every field shows its label and help, with the control its type calls for', async () => {
    const form = await render()
    try {
      expect(form.host.textContent).toContain('Service URL')
      expect(form.host.textContent).toContain('Where it runs')
      expect(form.field('Service URL')!.value).toBe('https://a.test')
      expect(form.field('Level')!.type).toBe('number')
      expect(form.host.querySelector('[role="switch"]')).not.toBeNull()
      expect((form.field('Tags') as unknown as HTMLTextAreaElement).value).toBe('a\nb')
      expect(form.host.querySelector('[role="combobox"]')?.textContent).toContain('fast')
    } finally {
      await form.done()
    }
  })

  test('a secret is never shown: it says it is set and offers to replace it', async () => {
    const form = await render()
    try {
      expect(form.host.textContent).toContain('Set')
      expect(form.host.querySelector('input[type="password"]')).toBeNull()
      await form.click(form.button('Replace'))
      expect(form.host.querySelector<HTMLInputElement>('input[type="password"]')).not.toBeNull()
    } finally {
      await form.done()
    }
  })

  test('nothing to save until something changes; then Save and Revert say so', async () => {
    const form = await render()
    try {
      expect(form.button('Save')!.disabled).toBe(true)
      expect(form.button('Revert')!.disabled).toBe(true)
      expect(form.host.textContent).not.toContain('Unsaved changes')
      await form.type(form.field('Service URL'), 'https://b.test')
      expect(form.host.textContent).toContain('Unsaved changes')
      expect(form.button('Save')!.disabled).toBe(false)
      await form.click(form.button('Revert'))
      expect(form.field('Service URL')!.value).toBe('https://a.test')
      expect(form.button('Save')!.disabled).toBe(true)
    } finally {
      await form.done()
    }
  })

  test('Save sends only what changed, typed; Cmd+S does the same from a field', async () => {
    const saved: Array<Record<string, ConfigValue>> = []
    const form = await render(CONFIG, async (values) => void saved.push(values))
    try {
      await form.type(form.field('Level'), '5')
      await form.type(form.field('Tags') as unknown as HTMLInputElement, 'a\n b \n\nc')
      await form.click(form.button('Save'))
      expect(saved).toEqual([{ level: 5, tags: ['a', 'b', 'c'] }])
      await form.type(form.field('Service URL'), 'https://c.test')
      await form.save(form.field('Service URL')!)
      expect(saved[1]).toEqual({ url: 'https://c.test' })
    } finally {
      await form.done()
    }
  })

  test('a replaced secret is sent; one left alone is not', async () => {
    const saved: Array<Record<string, ConfigValue>> = []
    const form = await render(CONFIG, async (values) => void saved.push(values))
    try {
      await form.click(form.button('Replace'))
      await form.type(form.field('API token'), 's3cret')
      await form.click(form.button('Save'))
      expect(saved).toEqual([{ token: 's3cret' }])
    } finally {
      await form.done()
    }
  })

  test('a required field left empty and a number out of range are said at the field, and nothing is sent', async () => {
    const saved: unknown[] = []
    const form = await render(CONFIG, async (values) => void saved.push(values))
    try {
      await form.type(form.field('Service URL'), '')
      await form.type(form.field('Level'), '12')
      await form.click(form.button('Save'))
      expect(saved).toEqual([])
      const alerts = [...form.host.querySelectorAll('[role="alert"]')].map(
        (node) => node.textContent,
      )
      expect(alerts).toContain('Service URL is required')
      expect(alerts).toContain('Level must be at most 9')
    } finally {
      await form.done()
    }
  })

  test('a refusal from the provider is said beside Save and the edits stay', async () => {
    const form = await render(CONFIG, async () => {
      throw new Error('"mode" must be one of fast, safe')
    })
    try {
      await form.type(form.field('Service URL'), 'https://b.test')
      await form.click(form.button('Save'))
      expect(form.host.querySelector('[role="alert"]')?.textContent).toContain('must be one of')
      expect(form.field('Service URL')!.value).toBe('https://b.test')
      expect(form.button('Save')!.disabled).toBe(false)
    } finally {
      await form.done()
    }
  })
})
