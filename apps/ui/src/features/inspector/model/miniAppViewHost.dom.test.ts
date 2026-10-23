import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
})
afterAll(async () => {
  await teardown()
})

/**
 * The agent drives a plugin's workbench view through the browser vocabulary. Each case pins a
 * way that could go wrong: the wrong subtree, a command that would run inside the app itself, and
 * a plugin that is not there.
 */
describe('plugin view host', () => {
  /** The command's chat is the one on screen, as when the person watches the agent work. */
  const here = { sessionId: 'S1', activeSessionId: 'S1' }

  async function withView() {
    const { railViewletRegistry, workItemKindRegistry } = await import('@/shared/contrib/uiContrib')
    const { setEnabledPluginNames } = await import('@/shared/contrib/miniAppActivation')
    setEnabledPluginNames(new Set(['focus-timer']))
    railViewletRegistry.register({
      kind: 'focus-timer:workspace',
      title: 'Focus Timer',
      pluginName: 'focus-timer',
    } as never)
    workItemKindRegistry.register({
      kind: 'focus-timer:workspace',
      pluginName: 'focus-timer',
    } as never)
    // What the grid renders for an open tab (GroupView's TabPanel carries the address).
    document.body.innerHTML = `
      <button>Send message</button>
      <div data-slot="tab-panel" data-work-item-id="focus-timer:workspace">
        <p>25:00</p><button>Start</button>
      </div>`
    const panel = document.querySelector<HTMLElement>('[data-slot="tab-panel"]')!
    panel.getBoundingClientRect = () => ({ width: 640, height: 480 }) as DOMRect
    return () => {
      railViewletRegistry.removeOwner('focus-timer')
      workItemKindRegistry.removeOwner('focus-timer')
      setEnabledPluginNames(null)
    }
  }

  test('a snapshot reads the plugin panel and nothing of the app around it', async () => {
    const cleanup = await withView()
    try {
      const { runPluginViewCommand } = await import('./miniAppViewHost')
      const reply = await runPluginViewCommand('focus-timer', { action: 'snapshot' }, here)
      expect(reply.ok).toBe(true)
      const tree = reply.result?.snapshot?.tree ?? ''
      expect(tree).toContain('Start')
      expect(tree).toContain('25:00')
      expect(tree).not.toContain('Send message')
      // Named after the view, not the chat window it sits in (a snapshot once read the app's title).
      expect(reply.result?.snapshot).toMatchObject({
        title: 'Focus Timer',
        url: 'plugin:focus-timer',
      })
    } finally {
      cleanup()
    }
  })

  test('evaluate is refused — alone or inside steps — before anything runs', async () => {
    const { runPluginViewCommand } = await import('./miniAppViewHost')
    for (const command of [
      { action: 'evaluate' as const, expression: 'document.cookie' },
      {
        action: 'steps' as const,
        steps: [{ action: 'evaluate' as const, expression: 'localStorage.clear()' }],
      },
    ]) {
      const reply = await runPluginViewCommand('focus-timer', command, here)
      expect(reply).toMatchObject({ ok: false, errorCode: 'bad_request' })
      expect(reply.error).toContain('inside the Localix app')
    }
  })

  test('an unknown plugin names the views this window does have', async () => {
    const cleanup = await withView()
    try {
      const { runPluginViewCommand } = await import('./miniAppViewHost')
      const reply = await runPluginViewCommand('focus-timr', { action: 'snapshot' }, here)
      expect(reply).toMatchObject({ ok: false, errorCode: 'not_found' })
      expect(reply.error).toContain('focus-timer')
    } finally {
      cleanup()
    }
  })

  test('a per-chat view is refused when its chat is not on screen, never read from another', async () => {
    // An agent in a background chat screenshotted the person's chat's board.
    const cleanup = await withView()
    try {
      const { runPluginViewCommand } = await import('./miniAppViewHost')
      const reply = await runPluginViewCommand(
        'focus-timer',
        { action: 'snapshot' },
        { sessionId: 'S2', activeSessionId: 'S1' },
      )
      expect(reply).toMatchObject({ ok: false, errorCode: 'failed' })
      expect(reply.error).toContain('not the one on screen')
    } finally {
      cleanup()
    }
  })

  test('in the desktop app a whole-view screenshot is the compositor’s, never a DOM re-render', async () => {
    // Rasterizing a large board's DOM froze the whole app.
    const cleanup = await withView()
    const calls: { command: string; args: unknown }[] = []
    const image = { data: 'AAAA', mediaType: 'image/jpeg', width: 640, height: 480 }
    ;(window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args })
          return image
        },
      },
    }
    try {
      const { runPluginViewCommand } = await import('./miniAppViewHost')
      const reply = await runPluginViewCommand('focus-timer', { action: 'screenshot' }, here)
      expect(reply).toMatchObject({ ok: true, result: { action: 'screenshot', image } })
      expect(calls.map((call) => call.command)).toEqual(['workbench_snapshot'])
      expect(calls[0]?.args).toMatchObject({ width: 640, height: 480 })
    } finally {
      delete (window as unknown as { __TAURI__?: unknown }).__TAURI__
      cleanup()
    }
  })

  test("another chat's copy of the view does not answer for this chat", async () => {
    const cleanup = await withView()
    try {
      // Another chat's copy stands FIRST in the document, where "opened as" used to find it.
      document.body.insertAdjacentHTML(
        'afterbegin',
        `<div data-slot="tab-panel" data-work-item-id="focus-timer:workspace@S9">
          <p>Another chat's timer</p>
        </div>`,
      )
      document.querySelector<HTMLElement>('[data-work-item-id$="@S9"]')!.getBoundingClientRect =
        () => ({ width: 640, height: 480 }) as DOMRect
      const { runPluginViewCommand } = await import('./miniAppViewHost')
      const reply = await runPluginViewCommand('focus-timer', { action: 'snapshot' }, here)
      const tree = reply.result?.snapshot?.tree ?? ''
      expect(tree).toContain('25:00')
      expect(tree).not.toContain('Another chat')
    } finally {
      cleanup()
    }
  })
})
