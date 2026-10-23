import { afterAll, beforeAll, expect, test } from 'bun:test'
import type { PublishedMessageContext } from '@localixai/mini-app-sdk/ui'
import { bindMiniAppUiTransport } from '@localixai/mini-app-sdk/ui/transport'
import { registerDom } from '@localixai/kit/testing'
import { bindMiniAppUiTestDoubles } from '@localixai/mini-app-sdk/ui/testing'

let teardown: () => Promise<void>
let unbindDoubles: () => void
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const priorActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT
beforeAll(() => {
  teardown = registerDom()
  // The dashboard reports failures through the host's `ProblemLine`, which the SDK resolves from
  // the host-bound component set; bind the same test doubles a plugin preload would.
  unbindDoubles = bindMiniAppUiTestDoubles()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  unbindDoubles()
  await teardown()
  if (priorActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment
})

test('renders one system surface, publishes its sample, marks stale data and clears context', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const snapshot = {
    capturedAt: '2026-09-22T08:00:00.000Z',
    os: { name: 'Linux', platform: 'linux', release: '6', architecture: 'x64', uptimeSeconds: 90 },
    cpu: { model: 'Test CPU', logicalCores: 1, usagePercent: 25, cores: [25] },
    memory: { totalBytes: 8192, freeBytes: 4096, usedBytes: 4096 },
    runtime: { name: 'Bun', version: '1.3.14', uptimeSeconds: 60, memoryBytes: 1024 },
  }
  let fail = false
  let requests = 0
  const requestedPaths: string[] = []
  let context: PublishedMessageContext | null = null
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) => {
      requests++
      requestedPaths.push(path)
      if (path.endsWith('/processes')) {
        return Response.json({ capturedAt: snapshot.capturedAt, processes: [] })
      }
      return fail ? new Response('Unavailable', { status: 503 }) : Response.json(snapshot)
    },
  })
  const publish = (next: PublishedMessageContext | null) => {
    context = next
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Workspace publishMessageContext={publish} />))
    expect(host.querySelector('h1')?.textContent).toBe('System overview')
    expect(host.textContent).toContain('Test CPU')
    expect(host.textContent).not.toMatch(/Hello World|Primitives/)
    expect(host.querySelector('[aria-labelledby="marks-title"]')).toBeNull()
    expect(host.querySelector('input[aria-label="Mark note"]')).toBeNull()
    expect(requestedPaths.some((path) => path.endsWith('/marks'))).toBe(false)
    expect(JSON.stringify(context)).toContain(snapshot.capturedAt)
    fail = true
    await act(async () => root.render(<Workspace active={false} publishMessageContext={publish} />))
    await act(async () => root.render(<Workspace active publishMessageContext={publish} />))
    expect(host.textContent).toContain('last successful sample')
    expect(JSON.stringify(context)).toContain('STALE:')
    const previousRequests = requests
    await act(async () => root.render(<Workspace active={false} publishMessageContext={publish} />))
    expect(context).toBeNull()
    expect(requests).toBe(previousRequests)
  } finally {
    await act(async () => root.unmount())
    unbind()
    host.remove()
  }
  expect(context).toBeNull()
})

test('a process list that failed to load says so, and never claims to be empty', async () => {
  // "No matching processes" used to render beside the error that explained them, claiming
  // the machine had no processes while the list was simply unknown.
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { Workspace } = await import('./Workspace')
  const unbind = bindMiniAppUiTransport({
    url: (path) => path,
    request: async (path) => {
      if (path.endsWith('/processes')) {
        return new Response('Unavailable', { status: 503 })
      }
      return Response.json({
        capturedAt: '2026-09-22T08:00:00.000Z',
        os: {
          name: 'Linux',
          platform: 'linux',
          release: '6',
          architecture: 'x64',
          uptimeSeconds: 1,
        },
        cpu: { model: 'Test CPU', logicalCores: 1, usagePercent: 25, cores: [25] },
        memory: { totalBytes: 8192, freeBytes: 4096, usedBytes: 4096 },
        runtime: { name: 'Bun', version: '1.3.14', uptimeSeconds: 1, memoryBytes: 1024 },
      })
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<Workspace />))
    await act(async () => Bun.sleep(0))
    expect(host.textContent).toContain('Test CPU')
    expect(host.textContent).not.toContain('No matching processes')
    expect(host.querySelectorAll('[role="alert"]').length).toBeGreaterThanOrEqual(1)
  } finally {
    await act(async () => root.unmount())
    unbind()
    host.remove()
  }
})
