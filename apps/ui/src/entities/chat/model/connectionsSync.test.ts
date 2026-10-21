import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { ProviderConnection } from '@/shared/api/contracts'
import { resourceSync } from '@/shared/api/resourceSync'
import { refreshConnections, registerConnectionsSync } from './connectionsSync'
import { useChatStore } from './store'

const connection = (id: string) =>
  ({ id, providerId: 'openai', hasApiKey: true }) as ProviderConnection

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

afterEach(() => {
  resourceSync.disconnected()
  useChatStore.setState({ connections: [] })
})

describe('connections writer', () => {
  test('an older answer that arrives last does not overwrite a newer one', async () => {
    const first = deferred<ProviderConnection[]>()
    const second = deferred<ProviderConnection[]>()
    const list = spyOn(backendClient, 'listConnections')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    try {
      const older = refreshConnections()
      const newer = refreshConnections()
      second.resolve([connection('new')])
      await newer
      first.resolve([connection('old')])
      await older
      expect(useChatStore.getState().connections.map((c) => c.id)).toEqual(['new'])
    } finally {
      list.mockRestore()
    }
  })

  test("the 'providers' topic re-reads through the same writer", async () => {
    const list = spyOn(backendClient, 'listConnections').mockResolvedValue([connection('topic')])
    const stop = registerConnectionsSync()
    try {
      resourceSync.connected()
      await resourceSync.refresh(['providers'])
      expect(useChatStore.getState().connections.map((c) => c.id)).toEqual(['topic'])
    } finally {
      stop()
      list.mockRestore()
    }
  })

  test('a topic read that started before an awaited refresh cannot land after it', async () => {
    const topic = deferred<ProviderConnection[]>()
    const list = spyOn(backendClient, 'listConnections')
      .mockReturnValueOnce(topic.promise)
      .mockResolvedValueOnce([connection('fresh')])
    const stop = registerConnectionsSync()
    try {
      resourceSync.connected()
      await new Promise((done) => setTimeout(done, 0))
      await refreshConnections()
      topic.resolve([connection('stale')])
      await new Promise((done) => setTimeout(done, 0))
      expect(useChatStore.getState().connections.map((c) => c.id)).toEqual(['fresh'])
    } finally {
      stop()
      list.mockRestore()
    }
  })
})
