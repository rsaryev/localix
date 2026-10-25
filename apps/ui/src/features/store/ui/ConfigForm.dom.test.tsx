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

const STRUCTURED: ListingConfig = {
  fields: [
    { key: 'env', label: 'Environment', type: 'map', required: false, secret: false },
    {
      key: 'tools',
      label: 'Tools',
      type: 'multichoice',
      required: false,
      secret: false,
      options: [{ value: 'read' }, { value: 'write', label: 'Write files' }],
    },
    { key: 'headers', label: 'Headers', type: 'map', required: false, secret: true },
  ],
  values: { env: { LOG: 'info' }, tools: ['read'] },
  set: ['headers'],
  scope: 'user',
  scopes: ['user'],
}

describe('the configuration form’s map and multiple-choice fields', () => {
  test('a map shows its pairs, takes a new one and saves the whole map', async () => {
    const saved: Array<Record<string, ConfigValue>> = []
    const form = await render(STRUCTURED, async (values) => void saved.push(values))
    try {
      const byLabel = (label: string) =>
        form.host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined
      const named = (label: string) =>
        form.host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
      expect(named('Environment name 1')!.value).toBe('LOG')
      expect(named('Environment value 1')!.value).toBe('info')
      await form.click(byLabel('Add Environment'))
      await form.type(named('Environment name 2'), 'DEBUG')
      await form.type(named('Environment value 2'), '1')
      await form.click(form.button('Save'))
      expect(saved).toEqual([{ env: { LOG: 'info', DEBUG: '1' } }])
      await form.click(byLabel('Remove Environment 1'))
      await form.click(form.button('Save'))
      expect(saved[1]).toEqual({ env: {} })
    } finally {
      await form.done()
    }
  })

  test('a secret map is only said to be set; replacing it asks for new pairs, masked', async () => {
    const saved: Array<Record<string, ConfigValue>> = []
    const form = await render(STRUCTURED, async (values) => void saved.push(values))
    try {
      const byLabel = (label: string) =>
        form.host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? undefined
      const secrets = () => form.host.querySelectorAll('input[type="password"]')
      expect(secrets()).toHaveLength(0)
      await form.click(form.button('Replace'))
      await form.click(byLabel('Add Headers'))
      await form.type(
        form.host.querySelector('input[aria-label="Headers name 1"]'),
        'Authorization',
      )
      await form.type(secrets()[0] as HTMLInputElement, 'Bearer x')
      await form.click(form.button('Save'))
      expect(saved).toEqual([{ headers: { Authorization: 'Bearer x' } }])
    } finally {
      await form.done()
    }
  })

  test('a multiple choice ticks any of its options and saves the list', async () => {
    const saved: Array<Record<string, ConfigValue>> = []
    const form = await render(STRUCTURED, async (values) => void saved.push(values))
    try {
      const box = (label: string) =>
        [...form.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((node) =>
          node.closest('label')?.textContent?.includes(label),
        )
      expect(box('read')!.checked).toBe(true)
      expect(box('Write files')!.checked).toBe(false)
      await form.click(box('Write files'))
      await form.click(form.button('Save'))
      expect(saved).toEqual([{ tools: ['read', 'write'] }])
    } finally {
      await form.done()
    }
  })
})

describe('the configuration form’s long text', () => {
  test('a multiline string is a text area that keeps its line breaks and saves them', async () => {
    const saved: Array<Record<string, ConfigValue>> = []
    const form = await render(
      {
        fields: [
          { key: 'name', label: 'Name', type: 'string', required: true, secret: false },
          {
            key: 'content',
            label: 'Instructions',
            type: 'string',
            required: true,
            secret: false,
            multiline: true,
          },
        ],
        values: { name: 'review', content: 'One\nTwo' },
        set: [],
        scope: 'user',
        scopes: ['user'],
      },
      async (values) => void saved.push(values),
    )
    try {
      expect(form.field('Name')!.tagName).toBe('INPUT')
      const area = form.field('Instructions')!
      expect(area.tagName).toBe('TEXTAREA')
      expect(area.value).toBe('One\nTwo')
      await form.type(area, 'One\nTwo\nThree')
      await form.click(form.button('Save'))
      expect(saved).toEqual([{ content: 'One\nTwo\nThree' }])
    } finally {
      await form.done()
    }
  })
})
