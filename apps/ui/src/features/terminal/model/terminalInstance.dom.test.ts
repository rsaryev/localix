import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
})

afterAll(async () => {
  await teardown()
})

/** happy-dom ships no FontFaceSet, so the load milestone is stubbed to fire it. */
function stubFontsReady(ready: Promise<unknown>) {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready },
  })
}

afterEach(() => {
  const owned = Object.getOwnPropertyDescriptor(document, 'fonts')
  if (owned) Reflect.deleteProperty(document, 'fonts')
})

describe('createTerminalInstance', () => {
  // THE REGRESSION. The web font landing changes the cell box and therefore the row
  // count, but the re-fit used to call the addon directly. That resizes the `.xterm`
  // element, NOT the host the pane observes, so no ResizeObserver fired and the PTY
  // was never told — the shell kept drawing to its old row count while xterm had a
  // new one, pushing a full-screen app's bottom status line outside the visible grid.
  test('routes the post-font-load remeasure through the pane sizer', async () => {
    stubFontsReady(Promise.resolve())
    const host = document.createElement('div')
    document.body.append(host)
    const remeasures: number[] = []

    const { createTerminalInstance } = await import('./terminalInstance')
    const instance = createTerminalInstance(
      host,
      () => false,
      () => {
        remeasures.push(1)
        return true
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(remeasures).toHaveLength(1)

    instance.dispose()
    instance.term.dispose()
    host.remove()
  })

  /**
   * Shell integration draws the per-command exit-code dot with `registerDecoration`, which
   * xterm marks EXPERIMENTAL and REFUSES unless the terminal opted into proposed API. The
   * refusal is a throw inside the parse loop, which the pane's guard swallows with a single
   * console warning — so the affordance was dead everywhere while the terminal looked healthy.
   */
  test('opts into the proposed API its shell integration depends on', async () => {
    const host = document.createElement('div')
    document.body.append(host)

    const { createTerminalInstance } = await import('./terminalInstance')
    const instance = createTerminalInstance(host, () => false)

    expect(instance.term.options.allowProposedApi).toBe(true)
    // The capability, not just the flag: registerDecoration is the call that used to throw.
    const marker = instance.term.registerMarker(0)
    expect(() => instance.term.registerDecoration({ marker, x: 0, width: 1 })).not.toThrow()

    instance.dispose()
    instance.term.dispose()
    host.remove()
  })

  test('does not remeasure a pane that was disposed before the font landed', async () => {
    let release: (() => void) | undefined
    stubFontsReady(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )
    const host = document.createElement('div')
    document.body.append(host)
    const remeasures: number[] = []
    let disposed = false

    const { createTerminalInstance } = await import('./terminalInstance')
    const instance = createTerminalInstance(
      host,
      () => disposed,
      () => {
        remeasures.push(1)
        return true
      },
    )

    disposed = true
    release?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(remeasures).toHaveLength(0)

    instance.dispose()
    instance.term.dispose()
    host.remove()
  })
})
