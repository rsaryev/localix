import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { UsageLogRow, UsageLogsPage } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function usageRow(messageId: string): UsageLogRow {
  return {
    messageId,
    createdAt: '2026-07-28T00:00:00.000Z',
    sessionId: 'session-1',
    sessionTitle: null,
    modelId: 'model-1',
    providerId: null,
    agentId: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    costSource: 'unknown',
    finishReason: null,
    durationMs: null,
    usageKind: 'unknown',
    keyLabel: null,
    keyMasked: null,
  }
}

describe('useUsageLogs request ownership', () => {
  test('a response completed while hidden cannot overwrite the next visible page', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { backendClient } = await import('@/shared/api/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/plugin-sdk/ui/visibility')
    const { useUsageLogs } = await import('./useUsageStats')

    const stale = deferred<UsageLogsPage>()
    const fresh = deferred<UsageLogsPage>()
    const pages = [stale.promise, fresh.promise]
    const logs = spyOn(backendClient, 'getUsageLogs').mockImplementation(async () => {
      const page = pages.shift()
      if (!page) throw new Error('Unexpected usage log request')
      return page
    })

    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Rows />
        </WorkItemVisibilityProvider>
      )
    }
    function Rows() {
      const result = useUsageLogs('30d', 1_700_000_000_000, {})
      return <output data-rows>{result.rows.map((row) => row.messageId).join(',')}</output>
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(<Surface visible />)
        await Promise.resolve()
      })
      expect(logs).toHaveBeenCalledTimes(1)

      await act(async () => root.render(<Surface visible={false} />))
      await act(async () => {
        stale.resolve({ rows: [usageRow('stale')], nextCursor: null })
        await Promise.resolve()
      })
      expect(host.querySelector('[data-rows]')?.textContent).toBe('')

      await act(async () => {
        root.render(<Surface visible />)
        await Promise.resolve()
      })
      expect(logs).toHaveBeenCalledTimes(2)
      await act(async () => {
        fresh.resolve({ rows: [usageRow('fresh')], nextCursor: null })
        await Promise.resolve()
      })
      expect(host.querySelector('[data-rows]')?.textContent).toBe('fresh')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      logs.mockRestore()
    }
  })
})
