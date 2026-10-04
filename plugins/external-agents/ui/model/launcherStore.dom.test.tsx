import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'

// NOTE: `react-dom/client` and the store under test are deliberately NOT statically imported — they
// must initialize AFTER registerDom() has installed a document. `check:architecture` enforces this.

let teardown: () => Promise<void>
let originalFetch: typeof fetch

/** Every `/launchers` request the store issued, in order — one per gesture, and never per render. */
let calls: string[] = []
let respond: () => { status: number; body: unknown } = () => ({
  status: 200,
  body: {
    launchers: [{ provider: 'codex', label: 'Codex', executable: 'codex', available: true }],
  },
})

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.includes('/launchers')) {
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    calls.push(url.slice(url.indexOf('/launchers')))
    const { status, body } = respond()
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

beforeEach(async () => {
  calls = []
  document.body.innerHTML = ''
  const { __resetAgentLaunchers } = await import('./launcherStore')
  __resetAgentLaunchers()
})

afterEach(() => {
  respond = () => ({
    status: 200,
    body: {
      launchers: [{ provider: 'codex', label: 'Codex', executable: 'codex', available: true }],
    },
  })
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await teardown()
})

/** Headless probes: the thing under test is what the STORE does, not what a menu draws. */
async function mount(probes: number) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useAgentLaunchers } = await import('./launcherStore')

  let latest: ReturnType<typeof useAgentLaunchers> | null = null
  let renders = 0
  function Probe() {
    latest = useAgentLaunchers()
    renders += 1
    return null
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        ...Array.from({ length: probes }, (_, i) => React.createElement(Probe, { key: i })),
      ),
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return {
    state: () => latest!,
    renders: () => renders,
    rerender: async () => {
      await act(async () => {
        root.render(
          React.createElement(
            React.Fragment,
            null,
            ...Array.from({ length: probes }, (_, i) => React.createElement(Probe, { key: i })),
          ),
        )
      })
    },
    unmount: async () => {
      await act(async () => root.unmount())
    },
  }
}

describe('the installed-CLI store', () => {
  test('loads once for every surface that asks, and once only', async () => {
    // The consumer is a titlebar item whose hook runs on every render of the chrome. A per-hook
    // fetch would put a PATH scan behind a bar that redraws whenever anything else in it changes.
    const probe = await mount(3)
    expect(calls).toEqual(['/launchers'])
    expect(probe.state().status).toBe('ready')
    expect(probe.state().launchers).toHaveLength(1)

    await probe.rerender()
    await probe.rerender()
    expect(calls).toEqual(['/launchers'])
    await probe.unmount()
  })

  test('a re-check asks again, and says so on the wire', async () => {
    const probe = await mount(1)
    const { refreshAgentLaunchers } = await import('./launcherStore')
    const React = await import('react')
    await React.act(async () => {
      refreshAgentLaunchers()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    // `refresh=1` is what skips the backend's TTL — the whole point of pressing the row.
    expect(calls).toEqual(['/launchers', '/launchers?refresh=1'])
    await probe.unmount()
  })

  test('a failed check reports the backend’s sentence and KEEPS the last good launchers', async () => {
    const probe = await mount(1)
    expect(probe.state().launchers).toHaveLength(1)

    respond = () => ({
      status: 500,
      body: { error: 'Could not check which agent CLIs are installed here.', detail: 'EACCES' },
    })
    const { refreshAgentLaunchers } = await import('./launcherStore')
    const React = await import('react')
    await React.act(async () => {
      refreshAgentLaunchers()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(probe.state().status).toBe('error')
    expect(probe.state().error).toBe('Could not check which agent CLIs are installed here.')
    // The raw driver text belongs in the Event Center, never on a menu line.
    expect(probe.state().errorDetail).toBe('EACCES')
    // A transient failure must not empty a menu that was correct a second ago.
    expect(probe.state().launchers).toHaveLength(1)
    await probe.unmount()
  })
})
