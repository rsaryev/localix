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
    expect(text).toContain('/mini-app create')
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

  test('reload rebuilds the person’s own mini apps and reports the ones that failed', async () => {
    const report = (ok: boolean) => ({
      ok,
      steps: [{ title: 'UI build', ok, problems: ok ? [] : ['UI build failed: bad import'] }],
    })
    let reloads = 0
    const text = await run(
      {
        reload: async () => {
          reloads++
          return [
            { name: 'notes', report: report(true) },
            { name: 'timer', report: report(false) },
          ]
        },
      },
      '/mini-app reload',
    )
    expect(reloads).toBe(1)
    expect(text).toContain('Mini apps reloaded.')
    expect(text).toContain('Rebuilt `notes`, `timer`.')
    expect(text).toContain('UI build failed: bad import')
    expect(text).not.toContain('- UI build: ok')
  })

  test('an unknown sub-command is told the actions instead of listing', async () => {
    const text = await run({}, '/mini-app disble chess')
    expect(text).toContain('Unknown sub-command `disble`')
    expect(text).toContain('/mini-app disable <name>')
    expect(text).toContain('/mini-app create <what it should do>')
    expect(text).not.toMatch(/plugin/iu)
  })
})
