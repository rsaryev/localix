import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'
import { closeNativePages } from './nativePages'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

test('permanent close deduplicates, stays within native batch limits and revokes pending opens', () => {
  const desktop = window as typeof window & { __TAURI__?: unknown }
  const previous = desktop.__TAURI__
  const calls: Array<{ command: string; tabIds: string[]; leases: Record<string, string> }> = []
  desktop.__TAURI__ = {
    core: {
      invoke: async (
        command: string,
        args: { tabIds: string[]; leases: Record<string, string> },
      ) => {
        calls.push({ command, ...args })
      },
    },
  }
  const ids = Array.from({ length: 205 }, (_, index) => `page-${index}`)
  const pendingLease = nativePageRendererLease.claim(ids[0]!)
  try {
    closeNativePages([...ids, ids[0]!], 'Close failed')
    expect(calls.map((call) => call.command)).toEqual(Array(3).fill('browser_close_many'))
    expect(calls.map((call) => call.tabIds.length)).toEqual([100, 100, 5])
    expect(calls.flatMap((call) => call.tabIds)).toEqual(ids)
    expect(calls[0]?.leases[ids[0]!]).toBe(pendingLease)
    expect(calls.map((call) => Object.keys(call.leases).length)).toEqual([100, 100, 5])
    expect(nativePageRendererLease.current(ids[0]!, pendingLease)).toBe(false)
    expect(nativePageRendererLease.last(ids[0]!)).toBeUndefined()
    closeNativePages(ids, 'Close failed')
    expect(calls).toHaveLength(3)
    const reopened = nativePageRendererLease.claim(ids[0]!)
    closeNativePages([ids[0]!], 'Close failed')
    expect(calls).toHaveLength(4)
    expect(calls[3]?.leases).toEqual({ [ids[0]!]: reopened })
  } finally {
    for (const id of ids) nativePageRendererLease.forget(id)
    if (previous) desktop.__TAURI__ = previous
    else delete desktop.__TAURI__
  }
})

test('web-only close does not retire a renderer without a native bridge', () => {
  const desktop = window as typeof window & { __TAURI__?: unknown }
  const previous = desktop.__TAURI__
  delete desktop.__TAURI__
  const lease = nativePageRendererLease.claim('web-only-page')
  try {
    closeNativePages(['web-only-page'], 'Close failed')
    expect(nativePageRendererLease.current('web-only-page', lease)).toBe(true)
  } finally {
    nativePageRendererLease.forget('web-only-page')
    if (previous) desktop.__TAURI__ = previous
  }
})
