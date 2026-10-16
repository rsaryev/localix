import { afterEach, describe, expect, test } from 'bun:test'

import { configurePlatformCapabilities } from './platformCapabilities'
import { restartDesktopApp } from './desktopRestart'

let restore: (() => void) | undefined
afterEach(() => {
  restore?.()
  restore = undefined
})

describe('restartDesktopApp', () => {
  test('asks the shell to restart when the native bridge is present', () => {
    const invoked: string[] = []
    let reloads = 0
    restore = configurePlatformCapabilities({
      desktop: {
        invoke: (command) => {
          invoked.push(command)
          // `restart_app` never resolves in the real shell — the process is replaced.
          return new Promise(() => {}) as Promise<never>
        },
      },
      navigation: { reload: () => void reloads++ },
    })

    restartDesktopApp()

    expect(invoked).toEqual(['restart_app'])
    expect(reloads).toBe(0)
  })

  test('reloads instead of doing nothing when there is no native bridge', () => {
    let reloads = 0
    restore = configurePlatformCapabilities({
      // What `platformCapabilities` returns off-desktop: not a rejection, a null.
      // `void null` was the whole bug — the only offered remedy was a no-op.
      desktop: { invoke: () => null },
      navigation: { reload: () => void reloads++ },
    })

    restartDesktopApp()

    expect(reloads).toBe(1)
  })

  test('a shell that refuses the restart still leaves the person a reload', async () => {
    let reloads = 0
    restore = configurePlatformCapabilities({
      desktop: { invoke: () => Promise.reject(new Error('restart refused')) },
      navigation: { reload: () => void reloads++ },
    })

    restartDesktopApp()
    await Promise.resolve()
    await Promise.resolve()

    expect(reloads).toBe(1)
  })
})
