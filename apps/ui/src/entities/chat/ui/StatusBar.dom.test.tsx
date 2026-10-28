import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { LspServerState } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const server = (patch: Partial<LspServerState>): LspServerState => ({
  serverId: 'go',
  serverName: 'Go',
  rootDir: '/repo',
  status: 'ready',
  errorCount: 0,
  warningCount: 0,
  ...patch,
})

async function render(servers: LspServerState[]) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { StatusBar } = await import('./StatusBar')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<StatusBar lspServers={servers} />))
  return {
    host,
    async unmount() {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const install = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[title*="language server"]') ?? undefined
/** What the bar shows for the install; its live region speaks a shorter line of its own. */
const shown = (item: HTMLElement) => item.querySelector('.tabular-nums')?.textContent

describe('language server install status', () => {
  test('a server being fetched shows what is installing and how far along it is', async () => {
    const view = await render([server({ status: 'installing', progress: 0.42 })])
    try {
      const item = install(view.host)!
      expect(shown(item)).toBe('Installing Go 42%')
      expect(item.getAttribute('title')).toBe(
        'Installing the Go language server. Code intelligence starts when it is ready.',
      )
    } finally {
      await view.unmount()
    }
  })

  test('an install without progress says so without a number', async () => {
    const view = await render([
      server({ serverId: 'typescript', serverName: 'TypeScript', status: 'installing' }),
      server({ serverId: 'json', serverName: 'JSON', status: 'installing' }),
    ])
    try {
      expect(shown(install(view.host)!)).toBe('Installing TypeScript, JSON')
    } finally {
      await view.unmount()
    }
  })

  test.each([
    [
      { reason: 'needs-toolchain', detail: 'Go' },
      'Go needs Go',
      'The Go language server is built with Go. Install Go to get code intelligence for these files.',
    ],
    [
      { reason: 'offline', detail: 'Could not reach proxy.golang.org' },
      'Go offline',
      'Could not download the Go language server: Could not reach proxy.golang.org. It is tried again on the next edit.',
    ],
    [
      { reason: 'failed', detail: 'gopls failed its checksum' },
      'Go not installed',
      'Could not install the Go language server: gopls failed its checksum. It is tried again later.',
    ],
  ] as const)(
    'an install that could not finish says why (%o)',
    async (unavailable, text, title) => {
      const view = await render([server({ status: 'unavailable', unavailable })])
      try {
        const item = install(view.host)!
        expect(shown(item)).toBe(text)
        expect(item.getAttribute('title')).toBe(title)
      } finally {
        await view.unmount()
      }
    },
  )

  test('nothing to say once every server is running', async () => {
    const view = await render([server({ status: 'ready' })])
    try {
      expect(install(view.host)).toBeUndefined()
    } finally {
      await view.unmount()
    }
  })
})
