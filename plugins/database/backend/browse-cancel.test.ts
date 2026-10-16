/**
 * A structured browse takes the query's cancellable path.
 *
 * It used to bypass it: no timeout, not in `live.inflight`, so a slow grid page held
 * PostgreSQL's single pooled connection, Stop did nothing to it, and disconnect waited for it
 * to finish on its own. Each case below failed before browse went through `runCancellable`.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { DbConnectionConfig } from './contracts'
import { driverFlags, type DbDriver, type DbTableSchema } from './drivers/port'
import { createDatabaseService } from './service'
import { createConnectionStore } from './store'

const empty = { columns: [], rows: [], durationMs: 0 }

/** A driver whose browse never finishes unless its signal aborts it. */
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-browse-cancel-'))
  let started = () => {}
  const reached = new Promise<void>((resolve) => {
    started = resolve
  })
  const createDriver = (): DbDriver => ({
    getFlags: () => driverFlags('postgres'),
    query: async () => empty,
    browse: (_request, signal) =>
      new Promise((_resolve, reject) => {
        started()
        const onAbort = () => reject(signal?.reason ?? new Error('aborted'))
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      }),
    schemas: async () => ({}),
    tableSchema: async (): Promise<DbTableSchema> => ({
      name: 't',
      type: 'table',
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      indexes: [],
    }),
    close: async () => {},
  })
  const service = createDatabaseService({
    store: createConnectionStore({ dir: path.join(dir, 'store') }),
    createDriver,
  })
  const { id } = await service.connect('u', {
    config: { dialect: 'postgres', host: 'localhost' } as DbConnectionConfig,
  })
  return { service, id, reached }
}

const page = { table: 't', limit: 10, offset: 0 }

describe('browse is cancellable', () => {
  test('Stop (cancel) aborts a running browse', async () => {
    const { service, id, reached } = await setup()
    const pending = service.browse('u', id, page, { timeoutMs: 0 })
    await reached
    expect(service.cancel('u', id)).toBe(1)
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  test('the wall-clock cap applies to a browse', async () => {
    const { service, id } = await setup()
    await expect(service.browse('u', id, page, { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  test("the caller's signal (a stopped agent turn) aborts it", async () => {
    const { service, id, reached } = await setup()
    const controller = new AbortController()
    const pending = service.browse('u', id, page, { timeoutMs: 0, signal: controller.signal })
    await reached
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  test('disconnect aborts a running browse instead of waiting for it', async () => {
    const { service, id, reached } = await setup()
    const pending = service.browse('u', id, page, { timeoutMs: 0 })
    await reached
    expect(await service.disconnect('u', id)).toBe(true)
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })
})
