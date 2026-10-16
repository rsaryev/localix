import { describe, expect, test } from 'bun:test'
import type { ComponentProps, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

import { KanbanCard } from './KanbanCard'

/**
 * The card renders inside a router, the same place the transcript renders it: its links navigate
 * through the host's router. Nothing here mocks a module: `mock.module` rewrites a module's
 * bindings for the whole test process and Bun never undoes it.
 */
const render = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

type Item = ComponentProps<typeof KanbanCard>['item']

const item = (input: unknown, output?: unknown): Item =>
  ({
    id: 'i1',
    type: 'tool_call',
    status: 'completed',
    toolCallId: 'tc1',
    name: 'kanban',
    input,
    output,
    activeVerb: 'Updating board',
  }) as Item

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('KanbanCard', () => {
  test('a card shows its status through the shared work tone, not a tinted capsule', () => {
    const task = {
      id: 'LX-10',
      title: 'Ship clean UI',
      status: 'in_progress',
      assignee: 'implementer',
      kind: 'epic',
      subtasks: [{ done: true }, { done: false }],
    }
    const html = render(<KanbanCard item={item({ action: 'update' }, { sessionId: 's1', task })} />)
    expect(html).toContain('bg-status-warning')
    expect(html).not.toContain('bg-foreground/10')
  })

  test('a blocked task says so in its header', () => {
    const html = plain(
      render(
        <KanbanCard
          item={item(
            { action: 'block', note: 'cannot compile' },
            { sessionId: 's1', task: { id: 'LX-9', title: 'Broken build', status: 'blocked' } },
          )}
        />,
      ),
    )
    expect(html).toContain('Blocked: Broken build')
  })

  test('search is a board slice like list: a title and a count, no per-task verb', () => {
    const tasks = [
      { id: 'LX-1', title: 'A', status: 'ready' },
      { id: 'LX-2', title: 'B', status: 'done' },
    ]
    const html = plain(
      render(
        <KanbanCard item={item({ action: 'search', query: 'x' }, { sessionId: 's1', tasks })} />,
      ),
    )
    expect(html).toContain('Kanban board')
    expect(html).toContain('2 tasks')
  })

  test('the links open in the chat the call ran in, and a result without one offers none', () => {
    const task = { id: 'LX-3', title: 'Linked', status: 'ready' }
    const linked = render(
      <KanbanCard item={item({ action: 'detail' }, { sessionId: 's1', task })} />,
    )
    expect(linked).toContain('aria-label="Open LX-3"')

    // A result persisted by an older build names no chat: a card id alone is not unique.
    const orphan = render(<KanbanCard item={item({ action: 'detail' }, { task })} />)
    expect(orphan).not.toContain('aria-label="Open LX-3"')
  })

  test('a create offers the board as a button and opens nothing itself', () => {
    const reveal = {
      type: 'ui.navigate',
      uri: 'localix://resource/kanban/board/s1',
      label: 'Open board',
    }
    const tasks = [
      { id: 'LX-1', title: 'One', status: 'backlog' },
      { id: 'LX-2', title: 'Two', status: 'backlog' },
    ]
    const html = render(
      <KanbanCard item={item({ action: 'create' }, { sessionId: 's1', tasks, reveal })} />,
    )
    expect(html).toContain('aria-label="Open board"')
  })
})
