import { registerDom } from '@localixai/kit/testing/dom'
import { afterAll, beforeAll, afterEach, expect, test } from 'bun:test'
import { announceNativeSettingsSaved, installNativeSettingsSync } from './nativeWorkspaceSync'

const original = globalThis.BroadcastChannel
const channels: FakeChannel[] = []
class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null
  closed = false
  constructor(_name: string) {
    channels.push(this)
  }
  postMessage(data: unknown): void {
    for (const channel of channels)
      if (channel !== this && !channel.closed) channel.onmessage?.({ data })
  }
  close(): void {
    this.closed = true
  }
}
let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})
afterEach(() => {
  delete window.__LOCALIX_WORKSPACE
  globalThis.BroadcastChannel = original
  channels.length = 0
})

test('only another workspace commit refreshes settings; cleanup disconnects', async () => {
  globalThis.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel
  window.__LOCALIX_WORKSPACE = { id: 'main', route: null }
  let reads = 0
  const stop = installNativeSettingsSync(async () => {
    reads++
  })
  announceNativeSettingsSaved()
  expect(reads).toBe(0)
  window.__LOCALIX_WORKSPACE = { id: 'workspace-peer', route: null }
  announceNativeSettingsSaved()
  await Promise.resolve()
  expect(reads).toBe(1)
  stop()
  announceNativeSettingsSaved()
  expect(reads).toBe(1)
})

test('a burst during a read is coalesced into one follow-up without losing the latest commit', async () => {
  globalThis.BroadcastChannel = FakeChannel as unknown as typeof BroadcastChannel
  window.__LOCALIX_WORKSPACE = { id: 'main', route: null }
  let release!: () => void
  let reads = 0
  const stop = installNativeSettingsSync(async () => {
    reads++
    if (reads === 1)
      await new Promise<void>((resolve) => {
        release = resolve
      })
  })
  window.__LOCALIX_WORKSPACE = { id: 'workspace-peer', route: null }
  announceNativeSettingsSaved()
  announceNativeSettingsSaved()
  announceNativeSettingsSaved()
  expect(reads).toBe(1)
  release()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(reads).toBe(2)
  stop()
})
