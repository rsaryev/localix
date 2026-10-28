import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { miniAppRealtime } from '@localixai/mini-app-sdk/ui/runtime'
import {
  registerDom,
  registerInspectorHandler,
  type InspectorRequest,
} from '@localixai/kit/testing'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
let originalFetch: typeof fetch
const realtimeMethods = { ...miniAppRealtime }

const connection = {
  id: 'primary',
  name: 'Primary PostgreSQL',
  dialect: 'postgres' as const,
  connected: true,
  readonly: false,
  createdAt: 100,
}

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.assign(miniAppRealtime, {
    onFrame: () => () => {},
    onReconnect: () => () => {},
    onDisconnect: () => () => {},
    request: async () => ({ subscribed: false }),
  })
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = url.endsWith('/rpc/database')
      ? { connections: [connection] }
      : url.endsWith('/schemas')
        ? { schemas: { public: [{ name: 'users', type: 'table' }] } }
        : url.includes('/table/users')
          ? {
              table: {
                schema: 'public',
                name: 'users',
                type: 'table',
                columns: [
                  {
                    name: 'id',
                    dataType: 'integer',
                    nullable: false,
                    pk: true,
                  },
                  {
                    name: 'name',
                    dataType: 'text',
                    nullable: false,
                    pk: false,
                  },
                ],
                primaryKey: ['id'],
                foreignKeys: [],
                indexes: [
                  {
                    name: 'users_pkey',
                    columns: ['id'],
                    unique: true,
                    primary: true,
                  },
                ],
              },
            }
          : url.endsWith('/browse')
            ? {
                result: {
                  columns: [{ name: 'id' }, { name: 'name' }],
                  rows: [[1, 'Ada']],
                  durationMs: 2,
                },
              }
            : url.endsWith('/ping')
              ? { alive: true }
              : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterAll(async () => {
  Object.assign(miniAppRealtime, realtimeMethods)
  globalThis.fetch = originalFetch
  await teardown()
})

describe('Database Workspace navigation', () => {
  test('renders saved connections as a compact tree and opens a connection work item', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DatabaseWorkspace } = await import('./DatabaseWorkspace')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    localStorage.clear()
    const opened: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => opened.push(request))

    try {
      await act(async () => {
        root.render(<DatabaseWorkspace sessionId="chat-a" requestedArea="overview" />)
        await turns()
      })
      expect(host.textContent).toContain('Primary PostgreSQL')
      expect(host.textContent).toContain('Connections')
      expect(host.querySelector('[role="tree"][aria-label="Database connections"]')).not.toBeNull()
      expect(host.querySelector('[aria-label="Search saved connections"]')).toBeNull()
      expect(host.textContent).not.toContain('Status')
      expect(host.textContent).not.toContain('Language')
      expect(host.textContent).not.toContain('Actions')
      expect(host.textContent).not.toContain('1 saved')
      expect(host.textContent).not.toContain('Double-click a table')
      expect(host.textContent).not.toContain(':memory:')
      expect(host.textContent).not.toContain('Workspace actions')
      expect(host.textContent).not.toContain('Available capabilities')
      expect(host.textContent).not.toContain('Namespaces')

      const connectionRow = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
        (row) => row.textContent?.includes('Primary PostgreSQL'),
      )
      expect(connectionRow).not.toBeUndefined()
      await act(async () => {
        connectionRow?.click()
      })
      expect(opened.at(-1)).toMatchObject({
        kind: 'work-item',
        workKind: 'database:connection',
        id: 'database:connection:primary',
        title: 'Primary PostgreSQL',
        // The tab opens in the workspace's own chat, never one the host guessed.
        scope: 'chat-a',
        payload: { connectionId: 'primary', dialect: 'postgres' },
      })
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
      localStorage.clear()
    }
  })

  test('offers SQLite memory as an explicit mode without exposing its driver sentinel', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DatabaseWorkspace } = await import('./DatabaseWorkspace')
    const host = document.createElement('div')
    const root = createRoot(host)
    localStorage.clear()

    try {
      await act(async () => {
        root.render(<DatabaseWorkspace sessionId="chat-a" requestedArea="overview" />)
        await turns()
      })
      const add = host.querySelector<HTMLButtonElement>('[aria-label="New connection"]')
      await act(async () => add?.click())
      const sqlite = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes('SQLite'),
      )
      await act(async () => sqlite?.click())

      const fileMode = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Database file',
      )
      const memoryMode = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'In-memory',
      )
      expect(fileMode?.getAttribute('aria-pressed')).toBe('true')
      expect(memoryMode?.getAttribute('aria-pressed')).toBe('false')
      expect(host.querySelector('input[placeholder="/path/to/database.sqlite"]')).not.toBeNull()

      await act(async () => memoryMode?.click())
      expect(memoryMode?.getAttribute('aria-pressed')).toBe('true')
      expect(host.textContent).toContain('Temporary SQLite database')
      expect(host.textContent).toContain('removed when this connection closes')
      expect(host.textContent).not.toContain(':memory:')
      expect(host.querySelector('input[placeholder="/path/to/database.sqlite"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      localStorage.clear()
    }
  })

  test('opens a table as a dedicated, stable work-item tab', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DatabaseWorkspace } = await import('./DatabaseWorkspace')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    localStorage.clear()
    const opened: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => opened.push(request))

    try {
      await act(async () => {
        root.render(<DatabaseWorkspace sessionId="chat-a" requestedArea="explorer" />)
        await turns()
      })
      const expand = host.querySelector<HTMLButtonElement>(
        '[aria-label="Expand Primary PostgreSQL"]',
      )
      await act(async () => {
        expand?.click()
        await turns()
      })
      const tableRow = [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
        (element) => element.getAttribute('title')?.startsWith('Click to open data'),
      )
      expect(tableRow).not.toBeUndefined()
      await act(async () => {
        tableRow?.click()
      })
      expect(opened.at(-1)).toMatchObject({
        kind: 'work-item',
        workKind: 'database:table',
        id: 'database:table:primary:public:users',
        title: 'users',
        scope: 'chat-a',
        payload: {
          connectionId: 'primary',
          connectionName: 'Primary PostgreSQL',
          dialect: 'postgres',
          schema: 'public',
          table: 'users',
          requestedMode: 'browse',
        },
      })

      const createTable = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.getAttribute('aria-label')?.startsWith('Create table in'),
      )
      await act(async () => createTable?.click())
      const createDialog = [...document.body.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (dialog) => dialog.textContent?.includes('Create table'),
      )
      expect(createDialog?.textContent).toContain('Open SQL in console')
      expect(createDialog?.textContent).toContain('Add column')
      await act(async () => {
        ;[...(createDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
          .find((button) => button.textContent?.trim() === 'Cancel')
          ?.click()
      })
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
      localStorage.clear()
    }
  })

  test('table work item renders bounded data, structure and inline-edit affordances', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DbTableTab } = await import('./DbTableTab')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    localStorage.clear()

    try {
      await act(async () => {
        root.render(
          <DbTableTab
            sessionId="chat-a"
            connectionId="primary"
            connectionName="Primary PostgreSQL"
            dialect="postgres"
            table="users"
            schema="public"
          />,
        )
      })
      // The grid loads lazily from disk: wait for what is asserted, however busy the machine is.
      const shown = () => ['Rows 1–1', 'name', 'Page 1'].every((t) => host.textContent?.includes(t))
      for (const deadline = Date.now() + 5_000; !shown() && Date.now() < deadline;)
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
      // The row count is stated ONCE now, by the workspace's own status line. This used to read
      // `'1 row'` — the shared `ResultFooter`'s phrasing from the second, duplicate bar that sat
      // directly above the pagination one. Same claim (the grid rendered its result), surviving
      // vocabulary.
      expect(host.textContent).toContain('Rows 1–1')
      expect(host.textContent).toContain('name')
      expect(host.textContent).toContain('Page 1')
      // …and the duplicate is gone rather than merely moved.
      expect(host.textContent).not.toMatch(/\b1 row\b/)
      expect(host.textContent).toContain('Add row')
      expect(host.textContent).not.toContain('Edit rows')
      expect(host.textContent).not.toContain('Editing rows')

      const structure = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Structure',
      )
      await act(async () => structure?.click())
      expect(host.textContent).toContain('Columns')
      expect(host.textContent).toContain('Edit fields directly')
      expect(host.textContent).not.toContain('Edit structure')
      expect(host.textContent).toContain('Review & apply')
      expect(host.querySelector('[aria-label="Name for name"]')).not.toBeNull()
      const defaultSql = host.querySelector<HTMLInputElement>('[aria-label="Default SQL for name"]')
      expect(defaultSql?.tagName).toBe('INPUT')
      expect(host.textContent).not.toContain('Autocomplete: type or press')
      const dataType = host.querySelector<HTMLInputElement>('[aria-label="Data type for name"]')
      expect(dataType).not.toBeNull()
      await act(async () => {
        if (!dataType) return
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(dataType), 'value')?.set?.call(
          dataType,
          'INTEGER',
        )
        dataType.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(host.textContent).toContain('1 pending')
      expect(dataType?.disabled).toBe(false)
      const nullable = host.querySelector<HTMLInputElement>('[aria-label="name nullable"]')
      expect(nullable?.disabled).toBe(false)
      await act(async () => nullable?.click())
      expect(host.textContent).toContain('2 pending')
      const review = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Review & apply',
      )
      expect(review?.disabled).toBe(false)
      const indexes = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.trim().startsWith('Indexes'),
      )
      await act(async () => indexes?.click())
      expect(host.textContent).toContain('users_pkey')
      const columns = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.trim().startsWith('Columns'),
      )
      await act(async () => columns?.click())
      expect(host.querySelector<HTMLInputElement>('[aria-label="Data type for name"]')?.value).toBe(
        'INTEGER',
      )
      expect(host.textContent).toContain('2 pending')
      expect(host.textContent).toContain('DDL')
      expect(host.querySelector('[aria-label="Back to connection"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      localStorage.clear()
    }
  })

  test('opens the relationship diagram as a dedicated stable work-item tab', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DbConnectionTab } = await import('./DbConnectionTab')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const opened: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => opened.push(request))

    try {
      await act(async () => {
        root.render(<DbConnectionTab sessionId="chat-a" connectionId="primary" />)
        await turns()
      })
      const actions = host.querySelector<HTMLButtonElement>(
        '[aria-label="Actions for Primary PostgreSQL"]',
      )
      expect(actions).not.toBeNull()
      await act(async () => {
        actions?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
        await Promise.resolve()
      })
      const diagram = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent?.includes('Relationship diagram'),
      )
      expect(diagram).not.toBeUndefined()
      await act(async () => diagram?.click())
      expect(opened.at(-1)).toMatchObject({
        kind: 'work-item',
        workKind: 'database:diagram',
        id: 'database:diagram:primary',
        title: 'Primary PostgreSQL relationships',
        scope: 'chat-a',
        payload: {
          connectionId: 'primary',
          connectionName: 'Primary PostgreSQL',
          dialect: 'postgres',
        },
      })
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('resolves a linked localix://resource/db/ table into its table work item', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { DatabaseWorkspace } = await import('./DatabaseWorkspace')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    localStorage.clear()
    const opened: InspectorRequest[] = []
    const unregister = registerInspectorHandler((request) => opened.push(request))

    try {
      await act(async () => {
        root.render(
          <DatabaseWorkspace
            sessionId="chat-a"
            requestedResourceUri="localix://resource/db/primary/_/public/users"
          />,
        )
        await turns()
      })
      expect(host.textContent).toContain('Primary PostgreSQL')
      expect(opened.at(-1)).toMatchObject({
        kind: 'work-item',
        workKind: 'database:table',
        title: 'users',
        payload: { connectionId: 'primary', schema: 'public', table: 'users' },
      })
    } finally {
      unregister()
      await act(async () => root.unmount())
      host.remove()
      localStorage.clear()
    }
  })
})
