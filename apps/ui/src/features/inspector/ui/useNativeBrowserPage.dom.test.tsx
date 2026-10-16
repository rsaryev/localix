import { afterAll, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { registerDom } from '@localixai/kit/testing/dom'
import { useNativeBrowserPage } from './useNativeBrowserPage'
import { closeNativePages } from '../model/nativePages'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'
import {
  browserTransferReadyKey,
  waitForTransferResources,
  workItemTransferReady,
} from '@/shared/lib/workItemTransferReady'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => teardown())

type Call = { command: string; args: Record<string, unknown> }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function desktopBridge(send: (call: Call) => Promise<unknown>) {
  const desktop = window as typeof window & { __TAURI__?: unknown }
  const previous = desktop.__TAURI__
  const calls: Call[] = []
  desktop.__TAURI__ = {
    core: {
      invoke(command: string, args: Record<string, unknown>) {
        const call = { command, args }
        calls.push(call)
        return send(call)
      },
    },
  }
  return {
    calls,
    restore() {
      if (previous) desktop.__TAURI__ = previous
      else delete desktop.__TAURI__
    },
  }
}

async function mountPage(tabId: string) {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const opened: string[] = []
  const errors: string[] = []
  function Page({ generation }: { generation: number }) {
    const { hostRef } = useNativeBrowserPage({
      tabId,
      url: 'https://example.com/',
      active: true,
      onOpened: () => opened.push(String(generation)),
      onError: (message) => errors.push(message),
    })
    return <div ref={hostRef} data-page />
  }
  const render = async (generation: number) => {
    await act(async () => root.render(<Page key={generation} generation={generation} />))
    const host = container.querySelector<HTMLElement>('[data-page]')!
    const rect = {
      x: 20,
      y: 80,
      width: 600,
      height: 400,
      top: 80,
      left: 20,
      right: 620,
      bottom: 480,
    }
    host.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect })
    await act(async () => window.dispatchEvent(new Event('resize')))
  }
  await render(1)
  return {
    opened,
    errors,
    render,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

const isVisibleBounds = ({ command, args }: Call) =>
  command === 'browser_bounds' && (args.bounds as { visible: boolean }).visible

test('an open finishing after unmount releases its exact lease and never displays a page', async () => {
  const open = deferred()
  const desktop = desktopBridge(async ({ command }) => {
    if (command === 'browser_open') await open.promise
  })
  const page = await mountPage('late-open-page')
  try {
    const lease = desktop.calls.find((call) => call.command === 'browser_open')!.args.lease
    await page.unmount()
    expect(desktop.calls).toContainEqual({
      command: 'browser_release',
      args: { tabId: 'late-open-page', lease },
    })
    await act(async () => open.resolve())
    expect(page.opened).toEqual([])
    expect(desktop.calls.filter(isVisibleBounds)).toEqual([])
    expect(desktop.calls.filter((call) => call.command === 'browser_release')).toHaveLength(2)
  } finally {
    desktop.restore()
  }
})

test('unmount drains a final hide after a busy visible bounds command', async () => {
  const busy = deferred()
  const desktop = desktopBridge(async (call) => {
    if (isVisibleBounds(call)) await busy.promise
  })
  const page = await mountPage('busy-bounds-page')
  try {
    expect(desktop.calls.filter(isVisibleBounds)).toHaveLength(1)
    const lease = desktop.calls.find(isVisibleBounds)!.args.lease
    await page.unmount()
    await act(async () => busy.resolve())
    const bounds = desktop.calls.filter((call) => call.command === 'browser_bounds')
    expect(bounds.at(-1)?.args).toEqual({
      tabId: 'busy-bounds-page',
      lease,
      bounds: { x: 0, y: 0, width: 0, height: 0, visible: false },
    })
    expect(bounds.filter(isVisibleBounds)).toHaveLength(1)
    expect(page.errors).toEqual([])
  } finally {
    desktop.restore()
  }
})

test('logical close suppresses a queued bounds failure before React unmounts the controller', async () => {
  const busy = deferred()
  const desktop = desktopBridge(async (call) => {
    if (isVisibleBounds(call)) {
      await busy.promise
      throw new Error('Closed page')
    }
  })
  const page = await mountPage('closing-bounds-page')
  try {
    closeNativePages(['closing-bounds-page'], 'Could not close page')
    await act(async () => busy.resolve())
    expect(page.errors).toEqual([])
  } finally {
    await page.unmount()
    nativePageRendererLease.forget('closing-bounds-page')
    desktop.restore()
  }
})

test('a remount has a newer lease and old queued bounds never address that lease', async () => {
  const oldBounds = deferred()
  let firstLease: unknown
  const desktop = desktopBridge(async (call) => {
    if (call.command === 'browser_open' && !firstLease) firstLease = call.args.lease
    if (isVisibleBounds(call) && call.args.lease === firstLease) await oldBounds.promise
  })
  const page = await mountPage('remounted-page')
  try {
    await page.render(2)
    const opens = desktop.calls.filter((call) => call.command === 'browser_open')
    const nextLease = opens[1]!.args.lease as string
    expect(nextLease).not.toBe(firstLease)
    expect(Number(nextLease.split('-')[0])).toBeGreaterThan(
      Number(String(firstLease).split('-')[0]),
    )
    expect(desktop.calls.findLast(isVisibleBounds)?.args.lease).toBe(nextLease)
    await act(async () => oldBounds.resolve())
    const lastBounds = desktop.calls.findLast((call) => call.command === 'browser_bounds')!
    expect(lastBounds.args.lease).toBe(firstLease)
    expect((lastBounds.args.bounds as { visible: boolean }).visible).toBe(false)
    expect(page.errors).toEqual([])
  } finally {
    await page.unmount()
    desktop.restore()
  }
})

test('transfer acceptance waits for successful visible bounds and fails if those bounds fail', async () => {
  const key = browserTransferReadyKey('failed-bounds-page')
  workItemTransferReady.arm([key])
  const bounds = deferred()
  const desktop = desktopBridge(async (call) => {
    if (isVisibleBounds(call)) {
      await bounds.promise
      throw new Error('Native page could not be shown')
    }
  })
  const page = await mountPage('failed-bounds-page')
  try {
    let accepted = false
    const acceptance = waitForTransferResources([key], 1000).then(() => {
      accepted = true
    })
    const result = acceptance.then(
      () => null,
      (error: unknown) => error,
    )
    expect(page.opened).toEqual(['1'])
    expect(accepted).toBe(false)
    await act(async () => bounds.resolve())
    expect(String(await result)).toContain('Native page could not be shown')
    expect(accepted).toBe(false)
  } finally {
    await page.unmount()
    workItemTransferReady.release([key])
    desktop.restore()
  }
})
