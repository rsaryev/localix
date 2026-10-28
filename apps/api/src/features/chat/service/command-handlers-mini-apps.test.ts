import { describe, expect, test } from 'bun:test'

import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { handleMiniAppsControlCommand } from './command-handlers-mini-apps'

const session = { id: 'session', projectId: 'p1' } as unknown as SessionRecord

function run(miniAppService: unknown, prompt: string) {
  let text = ''
  const reply = handleMiniAppsControlCommand(
    { miniAppService } as never,
    'user',
    session,
    prompt,
    async (value: string) => {
      text = value
      return {} as MessageMutationResponse
    },
  )
  return reply.then(() => text)
}

const app = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  description: '',
  scope: 'global',
  enabled: true,
  ...extra,
})

describe('/mini-app', () => {
  test('a bare /mini-app lists the scope’s mini apps and what holds each back', async () => {
    const scopes: unknown[] = []
    const text = await run(
      {
        list: async (_userId: string, opts: unknown) => {
          scopes.push(opts)
          return {
            miniApps: [
              app('chess', { displayName: 'Chess', version: '0.3.0' }),
              app('notes', { enabled: false }),
              app('board', { enabled: false, awaitingConsent: true }),
              app('timer', { error: 'register() threw' }),
            ],
          }
        },
      },
      '/mini-app',
    )
    expect(scopes).toEqual([{ projectId: 'p1' }])
    expect(text).toContain('**Mini apps**')
    expect(text).toContain('enabled `chess` · v0.3.0')
    expect(text).toContain('disabled `notes`')
    expect(text).toContain('waiting for your yes `board`')
    expect(text).toContain('error `timer` — register() threw')
    expect(text).not.toMatch(/plugin/iu)
  })

  test('with none installed it says where they come from', async () => {
    const text = await run({ list: async () => ({ miniApps: [] }) }, '/mini-app list')
    expect(text).toContain('No mini apps')
    expect(text).toContain('Store')
    expect(text).not.toMatch(/plugin/iu)
  })

  test('enable and disable switch one mini app in this chat’s project', async () => {
    const calls: unknown[] = []
    const service = { setEnabled: async (_u: string, input: unknown) => void calls.push(input) }
    expect(await run(service, '/mini-app enable chess')).toBe(
      'Enabled `chess`. Start a new turn for it to take effect.',
    )
    expect(await run(service, '/mini-app disable chess')).toBe(
      'Disabled `chess`. Start a new turn for it to take effect.',
    )
    expect(calls).toEqual([
      { name: 'chess', projectId: 'p1', enabled: true },
      { name: 'chess', projectId: 'p1', enabled: false },
    ])
    expect(await run(service, '/mini-app enable')).toBe('Usage: `/mini-app enable <name>`')
  })

  test('remove says what the owner refused', async () => {
    const removed: unknown[] = []
    expect(
      await run(
        { remove: async (_u: string, input: unknown) => void removed.push(input) },
        '/mini-app remove notes',
      ),
    ).toBe('Removed `notes`.')
    expect(removed).toEqual([{ name: 'notes', projectId: 'p1' }])
    expect(
      await run(
        {
          remove: async () => {
            throw new Error('"chess" ships with Localix; switch it off instead')
          },
        },
        '/mini-app remove chess',
      ),
    ).toBe('Remove failed: "chess" ships with Localix; switch it off instead')
  })

  test('reload re-reads every mini app folder, building nothing', async () => {
    let resyncs = 0
    const text = await run({ resync: async () => void resyncs++ }, '/mini-app reload')
    expect(resyncs).toBe(1)
    expect(text).toBe(
      'Mini apps reloaded. Their tools, screens and commands take effect on the next turn.',
    )
  })

  test('creating is not a sub-command: Localix runs and manages mini apps, it does not build them', async () => {
    const text = await run({}, '/mini-app create a timer')
    expect(text).toContain('Unknown sub-command `create`')
  })

  test('an unknown sub-command is told the actions instead of listing', async () => {
    const text = await run({}, '/mini-app disble chess')
    expect(text).toContain('Unknown sub-command `disble`')
    expect(text).toContain('/mini-app disable <name>')
    expect(text).not.toContain('/mini-app create')
    expect(text).not.toMatch(/plugin/iu)
  })

  describe('catalog', () => {
    const HOSTED =
      'https://github.com/rsaryev/localix/releases/latest/download/mini-app-catalog.json'
    const ADA = 'https://ada.test/mini-app-catalog.json'
    const entry = (name: string, source: string) => ({ name, source })
    const service = (calls: string[] = []) => ({
      catalogs: {
        list: async () => [
          { url: HOSTED, builtIn: true },
          { url: ADA, builtIn: false },
        ],
        preview: async (url: string) => {
          calls.push(`preview ${url}`)
          if (url.includes('broken'))
            throw new Error('The mini app catalog at broken.test answered 404')
          return { url, publishers: ['Ada'], apps: 2, icons: [], verified: false, added: false }
        },
        add: async (url: string) => void calls.push(`add ${url}`),
        remove: async (url: string) => {
          calls.push(`remove ${url}`)
          if (url === HOSTED)
            throw new Error('The Localix catalog comes with Localix and cannot be removed')
        },
      },
      store: {
        list: async () => ({
          entries: [entry('chess', HOSTED), entry('kanban', HOSTED), entry('notes', ADA)],
          problems: [],
        }),
      },
    })

    test('list shows each catalog with its app count, the built-in one marked', async () => {
      const text = await run(service(), '/mini-app catalog list')
      expect(text).toContain(`Localix _(built in)_ — 2 apps · ${HOSTED}`)
      expect(text).toContain(`ada.test — 1 app · ${ADA}`)
      expect(await run(service(), '/mini-app catalog')).toBe(text)
    })

    test('add reads the catalog first and says who publishes it, or why it was refused', async () => {
      const calls: string[] = []
      expect(await run(service(calls), '/mini-app catalog add https://bob.test/c.json')).toBe(
        'Added the catalog at `https://bob.test/c.json`: 2 apps from Ada, shown as unverified. They are in the store now.',
      )
      expect(calls).toEqual(['preview https://bob.test/c.json', 'add https://bob.test/c.json'])
      const refused: string[] = []
      expect(await run(service(refused), '/mini-app catalog add https://broken.test/c.json')).toBe(
        'The catalog was not added: The mini app catalog at broken.test answered 404',
      )
      expect(refused).toEqual(['preview https://broken.test/c.json'])
      expect(await run(service(), '/mini-app catalog add')).toBe(
        'Usage: `/mini-app catalog add <url>`',
      )
    })

    test('remove takes an added catalog away; the built-in one stays', async () => {
      const calls: string[] = []
      expect(await run(service(calls), `/mini-app catalog remove ${ADA}`)).toBe(
        `Removed the catalog at \`${ADA}\`. Apps you installed from it stay installed.`,
      )
      expect(await run(service(calls), `/mini-app catalog remove ${HOSTED}`)).toBe(
        'Remove failed: The Localix catalog comes with Localix and cannot be removed',
      )
    })

    test('the usage lists the catalog actions', async () => {
      const text = await run({}, '/mini-app nope')
      expect(text).toContain('/mini-app catalog list')
      expect(text).toContain('/mini-app catalog add <url>')
      expect(text).toContain('/mini-app catalog remove <url>')
    })
  })
})
