import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { Listing } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

test('a removal that warned says so, apart from a failure', async () => {
  const { act, useEffect } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useStoreActions } = await import('./useStoreActions')
  const client = {
    remove: async () => ({ warnings: ['"lib" was removed — warning: required by app'] }),
  } as unknown as StoreClient
  const listing = { ref: { kind: 'plugin', id: 'lib@m' }, installs: [] } as unknown as Listing
  let actions: ReturnType<typeof useStoreActions> | undefined
  function Probe() {
    const current = useStoreActions({ client, project: null, navigate: () => {} })
    useEffect(() => {
      actions = current
    })
    const { warning } = current
    return <p>{warning ?? ''}</p>
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Probe />))
  await act(async () => {
    actions!.remove(listing)
    await settle()
  })
  expect(host.textContent).toBe('"lib" was removed — warning: required by app')
  expect(actions!.problem).toBeNull()
  await act(async () => actions!.dismissWarning())
  expect(host.textContent).toBe('')
  await act(async () => root.unmount())
})
