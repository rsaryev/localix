import { describe, expect, test } from 'bun:test'

import type { PluginUpdatesResponse } from './contracts-updates'
import { createPluginStoreJobs } from './store-jobs'

const idle: PluginUpdatesResponse = { available: [], jobs: [], lastCheckedAt: null }

describe("the Store's plugin jobs", () => {
  test('a second install of a plugin while its first runs is not started', async () => {
    const jobs = createPluginStoreJobs(() => {})
    let started = 0
    let finish = () => {}
    const work = () => {
      started++
      return new Promise<void>((resolve) => (finish = resolve))
    }
    jobs.run('lint@shop', 'install', work)
    jobs.run('lint@shop', 'install', work)
    finish()
    await jobs.settled()
    expect(started).toBe(1)
  })

  test('an update the background pass runs later shows over a finished install', async () => {
    const jobs = createPluginStoreJobs(() => {})
    jobs.run('lint@shop', 'install', async () => {})
    await jobs.settled()
    const pass: PluginUpdatesResponse = {
      ...idle,
      jobs: [{ id: 'lint@shop', phase: 'downloading' }],
    }
    expect(jobs.of('lint@shop', pass)).toMatchObject({ action: 'update', phase: 'downloading' })
    expect(jobs.of('lint@shop', idle)).toMatchObject({ action: 'install', phase: 'done' })
  })
})
