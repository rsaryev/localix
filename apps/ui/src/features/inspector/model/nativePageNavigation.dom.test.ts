import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import { navigateReopenedNativePage } from './nativePageNavigation'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => teardown())

function withInvoke(run: (calls: Array<[string, unknown]>) => void): void {
  const desktop = window as typeof window & { __TAURI__?: unknown }
  const previous = desktop.__TAURI__
  const calls: Array<[string, unknown]> = []
  desktop.__TAURI__ = {
    core: { invoke: async (command: string, args: unknown) => void calls.push([command, args]) },
  }
  try {
    run(calls)
  } finally {
    if (previous) desktop.__TAURI__ = previous
    else delete desktop.__TAURI__
  }
}

const shown = { previewId: 'site', url: 'https://example.com/a', version: 1 }

test('a site reopened with another path or query navigates its existing native page', () => {
  withInvoke((calls) => {
    navigateReopenedNativePage(
      shown,
      { ...shown, url: 'https://example.com/b?page=2', version: 2 },
      true,
    )
    expect(calls).toEqual([
      ['browser_navigate', { tabId: 'site', url: 'https://example.com/b?page=2' }],
    ])
  })
})

test('a replayed version, a new tab or a framed preview leaves native pages alone', () => {
  withInvoke((calls) => {
    navigateReopenedNativePage(shown, shown, true)
    navigateReopenedNativePage(undefined, { ...shown, version: 2 }, true)
    const local = { previewId: 'dev', url: 'http://localhost:5173/', version: 1 }
    navigateReopenedNativePage(
      local,
      { ...local, url: 'http://localhost:5173/b', version: 2 },
      true,
    )
    navigateReopenedNativePage(shown, { ...shown, version: 2 }, false)
    expect(calls).toEqual([])
  })
})
