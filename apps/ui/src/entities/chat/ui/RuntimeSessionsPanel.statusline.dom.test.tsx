import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { resourceSync } from '@/shared/api/resourceSync'
import { useChatStore } from '@/entities/chat/model/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

/** One turn of the event loop: the resource scheduler hands a poke on in a zero-delay task. */
const nextTask = () => new Promise((done) => setTimeout(done, 0))

const session = (root: string, id: string, title: string) =>
  ({
    id,
    title,
    parentSessionId: root,
    createdAt: 1,
    rootSessionId: root,
    sessionKind: 'subagent',
    runtimeStatus: 'running',
  }) as UiSession

/**
 * Every timer of a second or more armed while `run` runs, to fire by hand: a client refresh tick
 * would be one. (SWR arms its own — deduping, slow-loading — which read nothing when fired.)
 */
async function longTimersDuring(run: () => Promise<void>): Promise<Array<() => void>> {
  const armed: Array<() => void> = []
  const realTimeout = globalThis.setTimeout
  const realInterval = globalThis.setInterval
  const spy =
    <T extends (...args: never[]) => unknown>(real: T) =>
    (...args: Parameters<T>) => {
      const [callback, ms] = args as unknown as [() => void, number | undefined]
      if (Number(ms ?? 0) >= 1000) {
        armed.push(callback)
        return real(...([() => {}, 0] as unknown as Parameters<T>))
      }
      return real(...args)
    }
  globalThis.setTimeout = spy(realTimeout) as unknown as typeof setTimeout
  globalThis.setInterval = spy(realInterval) as unknown as typeof setInterval
  try {
    await run()
  } finally {
    globalThis.setTimeout = realTimeout
    globalThis.setInterval = realInterval
  }
  return armed
}

async function renderPanel(root: string, sessions: UiSession[]) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { RuntimeSessionsPanel } = await import('./RuntimeSessionsPanel')
  useChatStore.setState({ allSessions: sessions })
  const host = document.createElement('div')
  document.body.append(host)
  const reactRoot = createRoot(host)
  await React.act(async () => {
    reactRoot.render(
      <RuntimeSessionsPanel scopeRootId={root} activeSessionId={null} onSelect={() => {}} />,
    )
  })
  await React.act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Show agent sessions"]')!.click()
  })
  const trigger = (label: string) =>
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  const unmount = async () => {
    await React.act(async () => reactRoot.unmount())
    host.remove()
  }
  return { act: React.act, trigger, unmount }
}

describe('RuntimeSessionsPanel with a plugin subagent status line', () => {
  test('draws the line’s text in a running subagent’s row and hides a row it empties', async () => {
    const originalSessions = useChatStore.getState().allSessions
    const originalRows = backendClient.getSubagentRows.bind(backendClient)
    const asked: string[] = []
    backendClient.getSubagentRows = (async (id: string) => {
      asked.push(id)
      return {
        active: true,
        rows: [
          { id: 'review', content: 'reviewer · 42k tokens' },
          { id: 'hidden', content: '' },
        ],
      }
    }) as typeof backendClient.getSubagentRows
    const panel = await renderPanel('drawn-root', [
      session('drawn-root', 'review', 'Review'),
      session('drawn-root', 'hidden', 'Quiet'),
      session('drawn-root', 'plain', 'Plain'),
    ])
    try {
      expect(asked).toEqual(['drawn-root'])
      expect(panel.trigger('Open Review')?.textContent).toContain('reviewer · 42k tokens')
      expect(panel.trigger('Open Quiet')).toBeNull()
      expect(panel.trigger('Open Plain')?.textContent).toContain('Plain')
    } finally {
      await panel.unmount()
      backendClient.getSubagentRows = originalRows
      useChatStore.setState({ allSessions: originalSessions })
    }
  })

  test('arms no refresh timer: the rows are read again on a `subagent-rows` poke alone', async () => {
    const originalSessions = useChatStore.getState().allSessions
    const originalRows = backendClient.getSubagentRows.bind(backendClient)
    let body = 'mapper · 1k tokens'
    let reads = 0
    backendClient.getSubagentRows = (async () => {
      reads++
      return { active: true, rows: [{ id: 'mapper', content: body }] }
    }) as typeof backendClient.getSubagentRows
    let panel: Awaited<ReturnType<typeof renderPanel>> | undefined
    try {
      const timers = await longTimersDuring(async () => {
        panel = await renderPanel('poked-root', [session('poked-root', 'mapper', 'Mapper')])
      })
      expect(reads).toBe(1)
      // The old panel re-read every two seconds while a subagent ran: firing every long timer
      // the panel armed, as if that much time had passed, reads nothing again.
      await panel!.act(async () => {
        for (const fire of timers) fire()
        await nextTask()
      })
      expect(reads).toBe(1)
      expect(panel!.trigger('Open Mapper')?.textContent).toContain('mapper · 1k tokens')

      // Another topic's poke is not this read model's change.
      await panel!.act(async () => {
        resourceSync.invalidate(['mods'])
        await nextTask()
      })
      expect(reads).toBe(1)

      body = 'mapper · 9k tokens'
      await panel!.act(async () => {
        resourceSync.invalidate(['subagent-rows'])
        await nextTask()
      })
      expect(reads).toBe(2)
      expect(panel!.trigger('Open Mapper')?.textContent).toContain('mapper · 9k tokens')
    } finally {
      await panel?.unmount()
      backendClient.getSubagentRows = originalRows
      useChatStore.setState({ allSessions: originalSessions })
    }
  })
})
