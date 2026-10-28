import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbConnectionInfo } from '../../dbClient'
import type { BrowsePage } from './useBrowsePage'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

const connection: DbConnectionInfo = {
  id: 'primary',
  name: 'Primary',
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  createdAt: 1,
}

/**
 * The re-show skip must key on a read that LANDED. Recording the key when the read starts would
 * make a tab hidden mid-flight (its read cancelled) come back empty forever: the key matches, so
 * nothing is sent again, and the cancelled result never arrived.
 */
describe('useBrowsePage re-show', () => {
  test('a read cancelled by hiding the tab is sent again on the next show', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { databaseApi } = await import('../../api/databaseApi')
    const { useBrowsePage } = await import('./useBrowsePage')

    const original = databaseApi.browse.bind(databaseApi)
    const pending: Array<() => void> = []
    let calls = 0
    databaseApi.browse = () => {
      calls += 1
      return new Promise((resolve) => {
        pending.push(() => resolve({ columns: [{ name: 'id' }], rows: [[1]], durationMs: 1 }))
      })
    }
    let latest: BrowsePage | null = null
    function Probe({ visible }: { visible: boolean }) {
      const page = useBrowsePage({ connection, target: { table: 'users' }, visible })
      React.useEffect(() => {
        latest = page
      })
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)

    try {
      await act(async () => root.render(<Probe visible />))
      expect(calls).toBe(1)
      // Hidden before the first read settles: that read is cancelled.
      await act(async () => root.render(<Probe visible={false} />))
      await act(async () => pending.shift()?.())
      expect(latest!.result).toBeNull()

      await act(async () => root.render(<Probe visible />))
      expect(calls).toBe(2)
      await act(async () => pending.shift()?.())
      expect(latest!.result?.rows.length).toBe(1)

      // Settled now: hiding and showing again reuses it.
      await act(async () => root.render(<Probe visible={false} />))
      await act(async () => root.render(<Probe visible />))
      expect(calls).toBe(2)
    } finally {
      await act(async () => root.unmount())
      databaseApi.browse = original
    }
  })
})
