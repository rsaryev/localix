import { describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiniAppHostServices } from '@localixai/mini-app-sdk/backend'

import { makeContext } from './native'

const storage = (label: string) => ({
  resolveDataDir: async (userId: string, sessionId: string) => `${label}:${userId}:${sessionId}`,
})
const context = (host?: MiniAppHostServices, perRun?: ReturnType<typeof storage>) =>
  makeContext(
    'sample-app',
    '/mini-apps/sample',
    {},
    () => {},
    '/work',
    'u1',
    join(tmpdir(), 'localix-native-session-storage-home'),
    host,
    undefined,
    perRun,
  )

describe('session storage on the mini app context', () => {
  test('a per-run load (tools) carries it — the load that used to have none', async () => {
    const ctx = context(undefined, storage('run'))
    expect(await ctx.sessionStorage?.resolveDataDir('u1', 's1')).toBe('run:u1:s1')
  })

  test('the boot load (routes) carries the host’s own, so both resolve through one owner', async () => {
    const ctx = context({ sessionStorage: storage('boot') } as MiniAppHostServices)
    expect(await ctx.sessionStorage?.resolveDataDir('u1', 's1')).toBe('boot:u1:s1')
  })

  test('a load given neither has none, and says so by its absence', () => {
    expect(context().sessionStorage).toBeUndefined()
  })
})
