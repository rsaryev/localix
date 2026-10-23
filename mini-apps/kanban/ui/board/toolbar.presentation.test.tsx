import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { MenuActionEntry, MenuEntry, MenuSubmenuEntry } from '@localixai/mini-app-sdk/ui'

import { KanbanCreateRow } from './toolbar-create-row'
import { KanbanFilterRow } from './toolbar-filter-row'
import { filterMenuEntries } from './toolbarFilterParts'
import type { KanbanFilters } from './useKanbanFilters'

const byId = (entries: readonly MenuEntry[], id: string) => {
  const found = entries.find((e) => 'id' in e && e.id === id)
  if (!found) throw new Error(`no menu row ${id}`)
  return found
}
const submenu = (entries: readonly MenuEntry[], id: string) => byId(entries, id) as MenuSubmenuEntry
const action = (entries: readonly MenuEntry[], id: string) => byId(entries, id) as MenuActionEntry

const noop = () => {}

const filters: KanbanFilters = {
  statusFilter: new Set(),
  originFilter: new Set(),
  priorityFilter: new Set(),
  labelFilter: new Set(),
  assigneeFilter: '',
  search: '',
  setSearch: noop,
  setAssigneeFilter: noop,
  toggleStatus: noop,
  toggleOrigin: noop,
  togglePriority: noop,
  toggleLabel: noop,
  assignees: [],
  labels: [],
  statsScoped: [],
  visible: [],
  filterCount: 0,
  clearAdvancedFilters: noop,
  filtersActive: false,
  resetFilters: noop,
}

describe('Kanban toolbar presentation', () => {
  test('composes quick creation from the shared input group and action scale', () => {
    const html = renderToStaticMarkup(
      <KanbanCreateRow
        draft="Ship toolbar"
        setDraft={noop}
        busy={false}
        onCreate={async () => {}}
        onOpenFullCreate={noop}
      />,
    )

    expect(html).toContain('data-slot="input-group"')
    expect(html).toContain('aria-label="Quick task creation"')
    expect(html).toContain('aria-label="New task actions"')
    expect(html).toContain('aria-label="New task with full details"')
    expect(html).toContain('aria-label="Add task"')
  })

  test('renders Board and Stats as one native radio choice', () => {
    const html = renderToStaticMarkup(
      <KanbanFilterRow view="board" onViewChange={noop} filters={filters} />,
    )

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Kanban view"')
    expect(html.match(/type="radio"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Board view"')
    expect(html).toContain('aria-label="Stats view"')
  })

  test('multi-select facets are toggles that return to a level whose hint shows the pick', () => {
    const toggled: string[] = []
    const entries = filterMenuEntries({
      ...filters,
      statusFilter: new Set(['ready']),
      priorityFilter: new Set(['high', 'low']),
      toggleStatus: (s) => toggled.push(`status:${s}`),
      togglePriority: (p) => toggled.push(`priority:${p}`),
    })
    const status = submenu(entries, 'status')
    expect(status.hint).toBe('Ready')
    expect(submenu(entries, 'priority').hint).toBe('2 selected')
    expect(submenu(entries, 'origin').hint).toBe('Any')
    const ready = action(status.items, 'status:ready')
    expect(ready.checked).toBe(true)
    expect(ready.keepOpen).toBe(true)
    expect(action(status.items, 'status:done').checked).toBe(false)
    ready.onSelect()
    action(submenu(entries, 'priority').items, 'priority:normal').onSelect()
    expect(toggled).toEqual(['status:ready', 'priority:normal'])
    // A facet with nothing to pick is not offered; nothing set, nothing to clear.
    expect(entries.some((e) => 'id' in e && (e.id === 'labels' || e.id === 'agent'))).toBe(false)
    expect(entries.some((e) => 'id' in e && e.id === 'clear')).toBe(false)
  })

  test('the agent facet is one choice with an "Any agent" row, and a set filter can be cleared', () => {
    const picks: string[] = []
    let cleared = false
    const entries = filterMenuEntries({
      ...filters,
      assignees: ['coder', 'critic'],
      assigneeFilter: 'coder',
      filterCount: 1,
      setAssigneeFilter: (a) => picks.push(a),
      clearAdvancedFilters: () => {
        cleared = true
      },
    })
    const agent = submenu(entries, 'agent')
    expect(agent.hint).toBe('@coder')
    expect(action(agent.items, 'agent:any').selected).toBe(false)
    expect(action(agent.items, 'agent:coder').selected).toBe(true)
    expect(action(agent.items, 'agent:coder').icon).toBeDefined()
    action(agent.items, 'agent:critic').onSelect()
    action(agent.items, 'agent:any').onSelect()
    expect(picks).toEqual(['critic', ''])
    action(entries, 'clear').onSelect()
    expect(cleared).toBe(true)
  })

  test('an active filter becomes a chip that clears only itself', () => {
    const html = renderToStaticMarkup(
      <KanbanFilterRow
        view="board"
        onViewChange={noop}
        filters={{
          ...filters,
          labelFilter: new Set(['flaky']),
          filterCount: 1,
          filtersActive: true,
        }}
      />,
    )
    expect(html).toContain('aria-label="Remove Label filter: flaky"')
  })
})
