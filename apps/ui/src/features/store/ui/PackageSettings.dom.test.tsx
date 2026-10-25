import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ListingConfig } from '@localixai/store'
import { configurePlatformCapabilities } from '@/shared/lib/platformCapabilities'
import { listing, renderStore } from '@/testing/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const config = (over: Partial<ListingConfig> = {}): ListingConfig => ({
  fields: [
    {
      key: 'url',
      label: 'Service URL',
      help: 'Where it runs',
      type: 'string',
      required: true,
      secret: false,
    },
    { key: 'token', label: 'API token', type: 'string', required: false, secret: true },
  ],
  values: { url: 'https://a.test' },
  set: ['token'],
  scope: 'user',
  scopes: ['user'],
  ...over,
})

const installed = [{ scope: 'user' as const, version: '1.0.0', enabled: true }]
const CHESS = listing({
  id: 'chess',
  displayName: 'Chess',
  installs: installed,
  configurable: true,
})

async function open(options: Parameters<typeof renderStore>[0]) {
  const view = await renderStore(options)
  const page = () => view.host.querySelector<HTMLElement>('[data-store-page]')!
  const tab = (label: string) =>
    [...page().querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (node) => node.textContent === label,
    )
  const field = (label: string) => {
    const found = [...page().querySelectorAll('label')].find((node) =>
      node.textContent?.startsWith(label),
    )
    return found ? page().querySelector<HTMLInputElement>(`#${CSS.escape(found.htmlFor)}`) : null
  }
  return { view, page, tab, field }
}

describe('a package’s Settings tab', () => {
  test('is on the page of an installed package that has settings, and nowhere else', async () => {
    const plain = listing({ id: 'plain', displayName: 'Plain', installs: installed })
    const fresh = listing({ id: 'fresh', displayName: 'Fresh', configurable: undefined })
    const withSettings = await open({
      listings: [CHESS, plain, fresh],
      configs: { chess: { user: config() } },
      target: { ref: { kind: 'mini-app', id: 'chess' } },
    })
    try {
      expect(withSettings.tab('Settings')).toBeDefined()
    } finally {
      await withSettings.view.done()
    }
    for (const id of ['plain', 'fresh']) {
      const without = await open({
        listings: [CHESS, plain, fresh],
        target: { ref: { kind: 'mini-app', id } },
      })
      try {
        expect(without.tab('Settings')).toBeUndefined()
      } finally {
        await without.view.done()
      }
    }
  })

  test('shows what is set, saves what changed, and the page reads again', async () => {
    const { view, tab, field } = await open({
      listings: [CHESS],
      configs: { chess: { user: config() } },
      target: { ref: { kind: 'mini-app', id: 'chess' } },
    })
    try {
      await view.click(tab('Settings'))
      expect(field('Service URL')!.value).toBe('https://a.test')
      await view.type(field('Service URL'), 'https://b.test')
      await view.click(view.button('Save'))
      expect(view.calls).toEqual(['config mini-app/chess user {"url":"https://b.test"}'])
    } finally {
      await view.done()
    }
  })

  test('an install’s own actions are buttons below its settings, and what they answer is said', async () => {
    const withActions = config({
      actions: [
        { id: 'test', label: 'Test connection' },
        { id: 'signout', label: 'Sign out', danger: true },
      ],
    })
    const { view, tab, page } = await open({
      listings: [CHESS],
      configs: { chess: { user: withActions } },
      actionResults: { test: { ok: true, message: 'Connected: 3 tools' } },
      target: { ref: { kind: 'mini-app', id: 'chess' } },
    })
    try {
      await view.click(tab('Settings'))
      expect(view.button('Sign out', page())).toBeDefined()
      await view.click(view.button('Test connection', page()))
      expect(view.calls).toEqual(['action mini-app/chess user test'])
      expect(page().textContent).toContain('Connected: 3 tools')
    } finally {
      await view.done()
    }
  })

  test('an address an action hands back is opened', async () => {
    const opened: string[] = []
    const restore = configurePlatformCapabilities({
      external: { open: (url) => void opened.push(url) },
    })
    const { view, tab, page } = await open({
      listings: [CHESS],
      configs: {
        chess: { user: config({ actions: [{ id: 'signin', label: 'Sign in' }] }) },
      },
      actionResults: { signin: { ok: true, open: 'https://auth.test/login' } },
      target: { ref: { kind: 'mini-app', id: 'chess' } },
    })
    try {
      await view.click(tab('Settings'))
      await view.click(view.button('Sign in', page()))
      expect(opened).toEqual(['https://auth.test/login'])
    } finally {
      restore()
      await view.done()
    }
  })

  test('a plugin installed for you and for the project has a switch between the two', async () => {
    const lint = listing({
      id: 'lint',
      displayName: 'Lint',
      ref: { kind: 'plugin', id: 'lint' },
      configurable: true,
      installs: [
        { scope: 'user', version: '1.0.0', enabled: true },
        { scope: 'project', version: '1.0.0', enabled: true },
      ],
    })
    const both = ['user', 'project'] as const
    const { view, tab, field, page } = await open({
      listings: [lint],
      project: { id: 'p1', name: 'Atlas' },
      configs: {
        lint: {
          user: config({ scopes: [...both] }),
          project: config({
            scope: 'project',
            scopes: [...both],
            values: { url: 'https://p.test' },
          }),
        },
      },
      target: { ref: { kind: 'plugin', id: 'lint' } },
    })
    try {
      await view.click(tab('Settings'))
      expect(field('Service URL')!.value).toBe('https://a.test')
      await view.openMenu(page().querySelector<HTMLElement>('[aria-label="Settings for"]')!)
      const atlas = [...document.body.querySelectorAll('[role="option"]')].find((node) =>
        node.textContent?.startsWith('Atlas'),
      )
      await view.click(atlas)
      expect(field('Service URL')!.value).toBe('https://p.test')
      await view.type(field('Service URL'), 'https://q.test')
      await view.click(view.button('Save'))
      expect(view.calls).toEqual(['config plugin/lint project in p1 {"url":"https://q.test"}'])
    } finally {
      await view.done()
    }
  })

  test('a refusal is said beside Save', async () => {
    const { view, tab, field, page } = await open({
      listings: [CHESS],
      configs: { chess: { user: config() } },
      configFails: 'The URL must start with https',
      target: { ref: { kind: 'mini-app', id: 'chess' } },
    })
    try {
      await view.click(tab('Settings'))
      await view.type(field('Service URL'), 'ftp://x')
      await view.click(view.button('Save'))
      expect(page().querySelector('[role="alert"]')?.textContent).toContain('must start with https')
      expect(field('Service URL')!.value).toBe('ftp://x')
    } finally {
      await view.done()
    }
  })
})
