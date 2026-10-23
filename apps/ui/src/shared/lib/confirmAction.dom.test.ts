import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
let originalOpen: typeof window.open
let opened: string[] = []

beforeAll(() => {
  teardown = registerDom()
  originalOpen = window.open
})

afterAll(async () => {
  window.open = originalOpen
  await teardown()
})

afterEach(async () => {
  const { resetConfirmationsForTests } = await import('./confirmAction')
  resetConfirmationsForTests()
  opened = []
})

/** No `__TAURI_INTERNALS__` here, so `openExternal` takes its web path — which
 *  makes `window.open` the observable end of the whole link chain. */
function captureOpens() {
  opened = []
  window.open = ((url?: string | URL) => {
    opened.push(String(url))
    return null
  }) as typeof window.open
}

test('external handoffs settle on decline, replacement and host removal', async () => {
  const { registerConfirmationHost, decideConfirmation } = await import('./confirmAction')
  const { confirmExternalHandoff } = await import('./externalLink')
  captureOpens()
  const unregister = registerConfirmationHost()
  const first = confirmExternalHandoff('https://auth.example.test/first', true)
  const second = confirmExternalHandoff('https://auth.example.test/second', true)
  expect(await first).toBe(false)
  decideConfirmation(false)
  expect(await second).toBe(false)
  const closing = confirmExternalHandoff('https://auth.example.test/closing', true)
  unregister()
  expect(await closing).toBe(false)
  expect(opened).toEqual([])
})

describe('confirmation gate (agnostic core)', () => {
  test('asks before performing when a host is mounted', async () => {
    const { requestConfirmation, pendingConfirmation, registerConfirmationHost } =
      await import('./confirmAction')
    const unmount = registerConfirmationHost()
    let performed = 0

    requestConfirmation({
      kind: 'test',
      title: 'Do the thing?',
      detail: 'the thing',
      perform: () => {
        performed += 1
      },
    })

    expect(pendingConfirmation()).toMatchObject({ kind: 'test', title: 'Do the thing?' })
    expect(performed).toBe(0)
    unmount()
  })

  test('confirming performs, declining does not', async () => {
    const { requestConfirmation, decideConfirmation, registerConfirmationHost } =
      await import('./confirmAction')
    const unmount = registerConfirmationHost()
    const done: string[] = []

    requestConfirmation({ kind: 'test', title: 'yes?', perform: () => done.push('yes') })
    decideConfirmation(true)
    requestConfirmation({ kind: 'test', title: 'no?', perform: () => done.push('no') })
    decideConfirmation(false)

    expect(done).toEqual(['yes'])
    unmount()
  })

  // THE GUARD. A confirmation nobody can see would be a brand-new way for an
  // action to do nothing — the exact failure this gate was built while fixing.
  test('performs immediately when no host is mounted', async () => {
    const { requestConfirmation, pendingConfirmation } = await import('./confirmAction')
    let performed = 0

    requestConfirmation({ kind: 'test', title: 'no host', perform: () => (performed += 1) })

    expect(performed).toBe(1)
    expect(pendingConfirmation()).toBeNull()
  })

  test('a host unmounting with a question open answers it rather than stranding it', async () => {
    const { requestConfirmation, pendingConfirmation, registerConfirmationHost } =
      await import('./confirmAction')
    const unmount = registerConfirmationHost()
    let performed = 0

    requestConfirmation({ kind: 'test', title: 'orphan', perform: () => (performed += 1) })
    expect(pendingConfirmation()).not.toBeNull()

    unmount()
    expect(pendingConfirmation()).toBeNull()
    expect(performed).toBe(0)
  })

  // THE REGRESSION THIS SHIPPED ONCE. `useSyncExternalStore` compares snapshots
  // by IDENTITY, so a `getSnapshot` that rebuilds its object per call reports a
  // change on every render — the host looped until React threw "Maximum update
  // depth exceeded" the moment a link was clicked.
  test('the snapshot keeps a stable identity between reads', async () => {
    const { requestConfirmation, pendingConfirmation, registerConfirmationHost } =
      await import('./confirmAction')
    expect(pendingConfirmation()).toBe(pendingConfirmation())

    const unmount = registerConfirmationHost()
    requestConfirmation({ kind: 'test', title: 'stable', perform: () => {} })
    const first = pendingConfirmation()
    expect(first).not.toBeNull()
    expect(pendingConfirmation()).toBe(first)
    expect(pendingConfirmation()).toBe(first)
    unmount()
  })

  test('the pending snapshot never exposes the callback', async () => {
    const { requestConfirmation, pendingConfirmation, registerConfirmationHost } =
      await import('./confirmAction')
    const unmount = registerConfirmationHost()
    requestConfirmation({ kind: 'test', title: 'hidden', perform: () => {} })
    expect(pendingConfirmation()).not.toHaveProperty('perform')
    unmount()
  })
})

describe('external link, as an outward action', () => {
  test('describes the destination and opens only on yes', async () => {
    const { confirmAndOpenExternal } = await import('./externalLink')
    const { pendingConfirmation, decideConfirmation, registerConfirmationHost } =
      await import('./confirmAction')
    captureOpens()
    const unmount = registerConfirmationHost()

    confirmAndOpenExternal('https://example.com/docs?q=1')
    expect(pendingConfirmation()).toMatchObject({
      kind: 'external-link',
      title: 'Open example.com?',
      // The FULL url, so the person sees exactly where they are going.
      detail: 'https://example.com/docs?q=1',
    })
    expect(opened).toEqual([])

    decideConfirmation(true)
    expect(opened).toEqual(['https://example.com/docs?q=1'])
    unmount()
  })

  test('mail and phone handoffs get their own wording', async () => {
    const { confirmAndOpenExternal } = await import('./externalLink')
    const { pendingConfirmation, registerConfirmationHost } = await import('./confirmAction')
    captureOpens()
    const unmount = registerConfirmationHost()

    confirmAndOpenExternal('mailto:hello@localix.dev')
    expect(pendingConfirmation()).toMatchObject({ title: 'Open your mail app?' })
    unmount()
  })
})

test('a request that requires a host is declined, not performed, while none is mounted', async () => {
  const { requestConfirmation } = await import('./confirmAction')
  const decisions: boolean[] = []
  let performed = 0
  requestConfirmation({
    kind: 'open-folder',
    title: 'Open?',
    requireHost: true,
    perform: () => performed++,
    onDecision: (proceed) => decisions.push(proceed),
  })
  expect(performed).toBe(0)
  expect(decisions).toEqual([false])
})
