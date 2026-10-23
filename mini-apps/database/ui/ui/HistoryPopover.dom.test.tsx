import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import * as miniAppUiSdk from '@localixai/mini-app-sdk/ui'
import { registerDom } from '@localixai/kit/testing'
import type { SqlHistoryEntry } from '../model/sqlHistory'
import type { SqlHistoryState } from '../model/useSqlHistory'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

interface ToastCall {
  message: string
  action?: { label: string; onClick: () => void }
}

/** A live history whose clear/restore actually mutate, as the real hook's do. */
function historyState(initial: SqlHistoryEntry[]) {
  const state = {
    entries: initial,
    revision: 0,
    restored: [] as Array<readonly SqlHistoryEntry[]>,
  }
  const api: SqlHistoryState = {
    get entries() {
      return state.entries
    },
    record: () => {},
    togglePin: () => {},
    clear: () => {
      state.entries = state.entries.filter((entry) => entry.pinned)
      state.revision += 1
      return state.revision
    },
    restore: (snapshot, revision) => {
      if (revision !== state.revision) return false
      state.revision += 1
      state.restored.push(snapshot)
      return true
    },
  }
  return { api, state }
}

async function render(history: SqlHistoryState) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const toasts: ToastCall[] = []
  const success = spyOn(miniAppUiSdk.toast, 'success').mockImplementation(
    (message: string, opts?: { action?: ToastCall['action'] }) => {
      toasts.push({ message: String(message), action: opts?.action })
      return 'id'
    },
  )
  const info = spyOn(miniAppUiSdk.toast, 'info').mockImplementation((message: string) => {
    toasts.push({ message: String(message) })
    return 'id'
  })
  const { HistoryPopover } = await import('./HistoryPopover')
  const { Popover, PopoverTrigger } = await import('@localixai/kit/popover')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <Popover open>
        <PopoverTrigger>History</PopoverTrigger>
        <HistoryPopover history={history} onPick={() => {}} />
      </Popover>,
    )
  })
  const clear = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Clear',
  )
  // The answer is anchored beside Clear, in the popover's header — not a toast, not a row.
  const feedback = () =>
    document.body.querySelector<HTMLElement>(
      '[data-slot="popover-content"] [data-slot="action-feedback"]',
    )
  const undo = () =>
    [...(feedback()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent === 'Undo',
    )
  return {
    act,
    host,
    toasts,
    clear,
    feedback,
    undo,
    cleanup: async () => {
      await act(async () => root.unmount())
      success.mockRestore()
      info.mockRestore()
      host.remove()
    },
  }
}

describe('query-history Clear', () => {
  test('offers an Undo instead of destroying up to 50 statements on one click', async () => {
    const snapshot: SqlHistoryEntry[] = [
      { sql: 'select 1', at: 30 },
      { sql: 'select 2', at: 20, pinned: true },
      { sql: 'select 3', at: 10 },
    ]
    const { api, state } = historyState(snapshot)
    const view = await render(api)
    try {
      const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')
      expect(content?.dataset.layout).toBe('structured')
      expect(content?.querySelector('[data-slot="popover-body"]')).not.toBeNull()
      expect(document.activeElement?.hasAttribute('data-history-search')).toBe(true)
      expect(view.clear).toBeDefined()
      expect(view.clear!.disabled).toBe(false)
      await view.act(async () => view.clear!.click())

      // The clear happened…
      expect(state.entries.map((entry) => entry.sql)).toEqual(['select 2'])
      // …and it is recoverable, with the count of what actually went (pinned excluded), said
      // beside the button and never written to the journal.
      expect(view.toasts).toHaveLength(0)
      expect(view.feedback()?.getAttribute('role')).toBe('status')
      expect(view.feedback()?.textContent).toContain('Cleared 2 queries')
      expect(view.undo()).toBeDefined()

      await view.act(async () => view.undo()!.click())
      // The PRE-clear list is handed back, so the merge in restoreHistory can re-add what
      // is missing without discarding anything recorded since.
      expect(state.restored).toEqual([snapshot])
      // Taking the Undo spends it: the answer is gone, so it cannot be clicked twice.
      expect(view.undo()).toBeUndefined()
    } finally {
      await view.cleanup()
    }
  })

  test('an Undo from an earlier clear does not resurrect what a later clear removed', async () => {
    const { api, state } = historyState([
      { sql: 'select 1', at: 30 },
      { sql: 'select 3', at: 10 },
    ])
    const view = await render(api)
    try {
      await view.act(async () => view.clear!.click())
      // A later clear (another Clear, or the console switching connection) moves the revision.
      state.entries = [{ sql: 'select 9', at: 40 }]
      api.clear()
      await view.act(async () => view.undo()!.click())
      expect(state.restored).toEqual([])
      expect(view.feedback()?.textContent).toContain('Nothing to undo')
      expect(view.toasts).toHaveLength(0)
    } finally {
      await view.cleanup()
    }
  })

  test('says nothing and does nothing when only pinned queries remain', async () => {
    const { api, state } = historyState([{ sql: 'select 2', at: 20, pinned: true }])
    const view = await render(api)
    try {
      // A clear that cannot remove anything must not claim it did.
      expect(view.clear!.disabled).toBe(true)
      expect(view.clear!.title).toContain('Nothing to clear')
      await view.act(async () => view.clear!.click())
      expect(view.toasts).toHaveLength(0)
      expect(view.feedback()?.textContent).toBe('')
      expect(state.entries).toHaveLength(1)
    } finally {
      await view.cleanup()
    }
  })
})
