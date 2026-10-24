import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { OFFICIAL_MARKETPLACE } from './marketplace-auto-update'
import { writeKnownMarketplaces } from './marketplace-catalog'
import type { MarketplaceSource } from './marketplace-source'
import {
  ensureOfficialMarketplace,
  forgetOfficialMarketplaceRemoval,
  rememberOfficialMarketplaceRemoval,
} from './official-marketplace'

const dir = tempDirPerTest('official-marketplace-')
const root = () => join(dir(), 'marketplaces')

function adder(fail?: Error) {
  const calls: MarketplaceSource[] = []
  const add = async (source: MarketplaceSource) => {
    calls.push(source)
    if (fail) throw fail
    await writeKnownMarketplaces(root(), {
      localix: { source, installLocation: join(root(), 'localix') },
    })
    return { name: 'localix', count: 1 }
  }
  return { add, calls }
}

describe('the official Localix marketplace on first start', () => {
  test('is registered from GitHub when it is not there yet', async () => {
    const { add, calls } = adder()
    expect(await ensureOfficialMarketplace({ root: root(), add, env: {} })).toEqual({
      status: 'registered',
    })
    expect(calls).toEqual([OFFICIAL_MARKETPLACE.source])
  })

  test('is left alone when it is already registered (idempotent)', async () => {
    const { add, calls } = adder()
    await ensureOfficialMarketplace({ root: root(), add, env: {} })
    expect(await ensureOfficialMarketplace({ root: root(), add, env: {} })).toEqual({
      status: 'present',
    })
    expect(calls).toHaveLength(1)
  })

  test('is not added back after the person removed it, until they add it themselves', async () => {
    const { add, calls } = adder()
    await rememberOfficialMarketplaceRemoval(root())
    expect(await ensureOfficialMarketplace({ root: root(), add, env: {} })).toEqual({
      status: 'declined',
    })
    expect(calls).toHaveLength(0)
    await forgetOfficialMarketplaceRemoval(root())
    expect((await ensureOfficialMarketplace({ root: root(), add, env: {} })).status).toBe(
      'registered',
    )
  })

  test('is skipped offline, and a failed fetch is tried again at the next start', async () => {
    const offline = adder()
    expect(
      await ensureOfficialMarketplace({
        root: root(),
        add: offline.add,
        env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      }),
    ).toMatchObject({ status: 'skipped' })
    expect(offline.calls).toHaveLength(0)

    const failing = adder(new Error('getaddrinfo ENOTFOUND github.com'))
    expect(await ensureOfficialMarketplace({ root: root(), add: failing.add, env: {} })).toEqual({
      status: 'skipped',
      reason: 'getaddrinfo ENOTFOUND github.com',
    })
    const next = adder()
    expect((await ensureOfficialMarketplace({ root: root(), add: next.add, env: {} })).status).toBe(
      'registered',
    )
  })
})
