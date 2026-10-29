import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ListingDetail } from '@localixai/store'
import type { StoreClient } from '@/shared/api/store-client'
import { compileLikeTheBuild } from '@/testing/reactCompiler'

// The package page's hooks as the desktop build ships them.
compileLikeTheBuild(/features\/store\/model\/useStoreData\.ts$/)

// Zero-delay timer turns: the poke is delivered with `setTimeout(..., 0)`, then SWR reads.
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

const ref = { kind: 'mini-app', id: 'chess' } as const

test('an open package page shows a removal as soon as the Store is poked', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { SWRConfig } = await import('swr')
  const { resourceSync } = await import('@/shared/api/resourceSync')
  const { useListingDetail } = await import('./useStoreData')
  let installed = true
  const client = {
    detail: async () =>
      ({ ref, installs: installed ? [{ scope: 'user' }] : [] }) as unknown as ListingDetail,
  } as unknown as StoreClient
  function Page() {
    const { data } = useListingDetail(client, ref, null)
    if (!data) return null
    return <p>{data.installs.length ? 'Installed' : 'Get'}</p>
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Page />
      </SWRConfig>,
    )
    await settle()
  })
  expect(host.textContent).toBe('Installed')

  installed = false
  await act(async () => {
    resourceSync.invalidate(['store'])
    await settle()
  })
  expect(host.textContent).toBe('Get')
  await act(async () => root.unmount())
})
