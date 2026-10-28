import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbConnectionConfig } from '../../dbClient'
import type { useConnectActions as UseConnectActions } from './useConnectActions'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test('connection actions ignore a test result invalidated by an input change', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { databaseApi } = await import('../../api/databaseApi')
  const { useConnectActions } = await import('./useConnectActions')

  const originalTest = databaseApi.test.bind(databaseApi)
  const older = deferred<{ hostKeyFingerprint?: string }>()
  const newer = deferred<{ hostKeyFingerprint?: string }>()
  databaseApi.test = (config) =>
    !('file' in config) && config.host === 'older' ? older.promise : newer.promise

  const olderConfig: DbConnectionConfig = { dialect: 'postgres', host: 'older' }
  const newerConfig: DbConnectionConfig = { dialect: 'postgres', host: 'newer' }
  let config = olderConfig
  let actions: ReturnType<typeof UseConnectActions> | undefined

  function Harness() {
    const latest = useConnectActions({
      config,
      name: '',
      edit: undefined,
      onConnected: () => {},
      vaultPassword: false,
      isFields: true,
      vaultSsh: false,
      vaultTlsKey: false,
      setTls: () => {},
      setTlsAdv: () => {},
    })
    React.useEffect(() => {
      actions = latest
    })
    return null
  }

  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness />))
    await act(async () => {
      void actions!.test()
      await Promise.resolve()
    })
    expect(actions?.testing).toBe(true)

    await act(async () => {
      config = newerConfig
      actions!.resetTest()
      root.render(<Harness />)
    })
    await act(async () => {
      void actions!.test()
      newer.resolve({ hostKeyFingerprint: 'SHA256:newer' })
      await newer.promise
    })
    expect(actions?.testOk).toBe(true)
    // The key a save would pin is surfaced from the passing test…
    expect(actions?.testedHostKey).toBe('SHA256:newer')

    await act(async () => {
      older.reject(new Error('stale failure'))
      await older.promise.catch(() => {})
    })
    expect(actions?.testOk).toBe(true)
    // …and a stale test for another target cannot replace it.
    expect(actions?.testedHostKey).toBe('SHA256:newer')
    expect(actions?.error).toBeNull()
    expect(actions?.testing).toBe(false)
  } finally {
    await act(async () => root.unmount())
    databaseApi.test = originalTest
  }
})

test('connection actions collapse duplicate submits before React disables the form', async () => {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { databaseApi } = await import('../../api/databaseApi')
  const { useConnectActions } = await import('./useConnectActions')

  const originalConnect = databaseApi.connect.bind(databaseApi)
  const pending = deferred<{
    id: string
    name: string
    dialect: 'sqlite'
    connected: true
    readonly: false
    createdAt: number
  }>()
  let calls = 0
  let connected = 0
  databaseApi.connect = () => {
    calls += 1
    return pending.promise
  }

  let actions: ReturnType<typeof UseConnectActions> | undefined
  function Harness() {
    const latest = useConnectActions({
      config: { dialect: 'sqlite', file: ':memory:' },
      name: '',
      edit: undefined,
      onConnected: () => {
        connected += 1
      },
      vaultPassword: false,
      isFields: true,
      vaultSsh: false,
      vaultTlsKey: false,
      setTls: () => {},
      setTlsAdv: () => {},
    })
    React.useEffect(() => {
      actions = latest
    })
    return null
  }

  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Harness />))
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = actions!.submit()
      second = actions!.submit()
      await Promise.resolve()
    })
    expect(calls).toBe(1)
    expect(actions?.busy).toBe(true)

    await act(async () => {
      pending.resolve({
        id: 'memory',
        name: 'memory',
        dialect: 'sqlite',
        connected: true,
        readonly: false,
        createdAt: 1,
      })
      await Promise.all([first, second])
    })
    expect(connected).toBe(1)
    expect(actions?.busy).toBe(false)
  } finally {
    await act(async () => root.unmount())
    databaseApi.connect = originalConnect
  }
})
