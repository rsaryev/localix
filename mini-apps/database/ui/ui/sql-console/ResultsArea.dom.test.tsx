import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import { warmMiniAppUiComponents } from '@localixai/kit/testing/lent-components'
import type { SqlConsoleState } from '../../model/useSqlConsole'
import type { ResultTab } from '../../model/resultTabs'
import type { RowEditTarget } from '../../model/rowMutations'

let teardown: () => Promise<void>

beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The mini app SDK binds TableGrid as a lazy host component. Warm the host modules
  // once so these tests exercise row mutations rather than Suspense timing.
  await warmMiniAppUiComponents()
})

afterAll(async () => {
  await teardown()
})

function resultConsole(id: string, seq: number, column: string): SqlConsoleState {
  const outcome = {
    result: {
      columns: [{ id: 'c0', title: column, type: 'text' as const }],
      rows: [{ c0: `${id}-row` }],
    },
    durationMs: 1,
  }
  const active: ResultTab = {
    id,
    seq,
    kind: 'result',
    label: id,
    sql: `SELECT ${column} FROM ${id}`,
    browse: { table: id },
    outcome,
  }
  return {
    tabs: [active],
    active,
    activeTabId: id,
    outcome,
    sortedRows: outcome.result.rows,
    totalRows: 1,
    filter: '',
    sort: undefined,
    activateTab: () => {},
    closeTab: () => {},
    clearOutput: () => {},
    toggleSort: () => {},
    setFilter: () => {},
  } as unknown as SqlConsoleState
}

const edit: RowEditTarget = {
  connectionId: 'primary',
  table: 'users',
  dialect: 'postgres',
  pk: ['id'],
  onCommitted: () => {},
}

const findButton = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === label,
  ) ?? null

describe('result-grid mutation scope', () => {
  test('drops staged rows when another result tab becomes active', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ResultsArea } = await import('./ResultsArea')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const render = (consoleState: SqlConsoleState) => (
      <ResultsArea
        c={consoleState}
        editError={null}
        onDismissEditError={() => {}}
        edit={edit}
        editable
        onCommitChanges={async () => false}
      />
    )

    try {
      await act(async () => root.render(render(resultConsole('users', 1, 'name'))))
      const add = findButton(host, 'Add row')
      expect(add).not.toBeNull()
      await act(async () => add?.click())
      const draft = host.querySelector<HTMLInputElement>('input[placeholder="NULL"]')
      expect(draft).not.toBeNull()
      await act(async () => {
        if (!draft) return
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          draft,
          'Ada',
        )
        draft.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const insert = host.querySelector<HTMLButtonElement>('button[title="Insert row"]')
      expect(insert).not.toBeNull()
      await act(async () => insert?.click())
      expect(host.textContent).toContain('1 new unsaved')

      await act(async () => root.render(render(resultConsole('teams', 2, 'title'))))
      expect(host.textContent).not.toContain('unsaved')
      expect(host.textContent).toContain('teams')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('drops staged rows when the same query tab is refreshed', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { ResultsArea } = await import('./ResultsArea')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const render = (seq: number) => (
      <ResultsArea
        c={resultConsole('users', seq, 'name')}
        editError={null}
        onDismissEditError={() => {}}
        edit={edit}
        editable
        onCommitChanges={async () => false}
      />
    )

    try {
      await act(async () => root.render(render(1)))
      const add = findButton(host, 'Add row')
      expect(add).not.toBeNull()
      await act(async () => add?.click())
      const insert = host.querySelector<HTMLButtonElement>('button[title="Insert row"]')
      expect(insert).not.toBeNull()
      await act(async () => insert?.click())
      expect(host.textContent).toContain('1 new unsaved')

      await act(async () => root.render(render(2)))
      expect(host.textContent).not.toContain('unsaved')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
