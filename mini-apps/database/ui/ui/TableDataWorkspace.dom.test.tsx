import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import { warmMiniAppUiComponents } from '@localixai/kit/testing/lent-components'
import type { DbConnectionInfo, DbTableSchema } from '../dbClient'
import { databaseApi } from '../api/databaseApi'
import type { SchemaState } from '../model/useSchema'

let teardown: () => Promise<void>

beforeAll(async () => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The structure and DDL views report through the host's lazy problem line; on a cold cache it
  // had not loaded by the assertion, and the engine's reason was simply absent.
  await warmMiniAppUiComponents()
})

afterAll(async () => {
  await teardown()
})

const connection: DbConnectionInfo = {
  id: 'primary',
  name: 'Primary',
  dialect: 'sqlite',
  connected: true,
  readonly: false,
  createdAt: 1,
}

const table: DbTableSchema = {
  name: 'users',
  type: 'table',
  columns: [{ name: 'id', dataType: 'INTEGER', nullable: false, pk: true }],
  primaryKey: ['id'],
  foreignKeys: [],
  indexes: [],
}

/** The Structure tab button — the only way in, there is no prop to preselect the view. */
async function openStructure(host: HTMLElement) {
  const tab = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Structure',
  )
  expect(tab).toBeDefined()
  return tab!
}

const nameInput = (host: HTMLElement) =>
  host.querySelector<HTMLInputElement>('input[placeholder="column_name"]')

/**
 * Set a controlled input's value the way a user does: through the native value setter
 * (React's own descriptor would swallow the assignment) plus a bubbling `input` event,
 * so the real onChange handler runs.
 */
function typeInto(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const schema = {
  getTable: () => table,
  getTableError: () => undefined,
  getTableErrorDetail: () => undefined,
  loadTable: () => {},
  reloadTable: () => {},
} as unknown as SchemaState

describe('table data mutation scope', () => {
  // A parked tab must not read, and a RE-SHOWN tab must not re-read the same page: the browse
  // effect used to depend on visibility itself, so every switch back to the tab re-sent the query
  // and flashed the loading overlay.
  test('a parked table browses once it becomes visible, and not again on re-show', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBrowse = databaseApi.browse.bind(databaseApi)
    let calls = 0
    databaseApi.browse = async () => {
      calls += 1
      return { columns: [{ name: 'id' }], rows: [[1]], durationMs: 1 }
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    const render = (visible: boolean) => (
      <WorkItemVisibilityProvider visible={visible}>
        <TableDataWorkspace
          connection={connection}
          target={{ table: 'users' }}
          schema={schema}
          onOpenConsole={() => {}}
          onOpenConsoleWithSql={() => {}}
        />
      </WorkItemVisibilityProvider>
    )

    try {
      await act(async () => root.render(render(false)))
      expect(calls).toBe(0)

      await act(async () => root.render(render(true)))
      expect(calls).toBe(1)

      await act(async () => root.render(render(false)))
      await act(async () => root.render(render(true)))
      expect(calls).toBe(1)

      // An explicit refresh is a new read, visible or not the key changed.
      const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh data"]')
      expect(refresh).not.toBeNull()
      await act(async () => refresh!.click())
      expect(calls).toBe(2)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.browse = originalBrowse
    }
  })

  test('allows inserts but not updates or deletes when a writable table has no primary key', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBrowse = databaseApi.browse.bind(databaseApi)
    databaseApi.browse = async () => ({
      columns: [{ name: 'name' }],
      rows: [['Ada']],
      durationMs: 1,
    })
    const tableWithoutPrimaryKey: DbTableSchema = {
      ...table,
      columns: [{ name: 'name', dataType: 'TEXT', nullable: false, pk: false }],
      primaryKey: [],
    }
    const schemaWithoutPrimaryKey = {
      ...schema,
      getTable: () => tableWithoutPrimaryKey,
      getTableError: () => undefined,
    } as unknown as SchemaState
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={schemaWithoutPrimaryKey}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })

      expect(host.textContent).toContain('Add row')
      expect(host.querySelector('button[title="Delete row"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.browse = originalBrowse
    }
  })

  test('does not expose row mutations for a read-only connection', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBrowse = databaseApi.browse.bind(databaseApi)
    databaseApi.browse = async () => ({ columns: [{ name: 'id' }], rows: [[1]], durationMs: 1 })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={{ ...connection, readonly: true }}
            target={{ table: 'users' }}
            schema={schema}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })

      expect(host.textContent).not.toContain('Add row')
      expect(host.querySelector('button[title="Delete row"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.browse = originalBrowse
    }
  })

  test('drops staged changes when the data is refreshed', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBrowse = databaseApi.browse.bind(databaseApi)
    databaseApi.browse = async () => ({ columns: [{ name: 'id' }], rows: [[1]], durationMs: 1 })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={schema}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })
      const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Add row',
      )
      await act(async () => add?.click())
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[title="Insert row"]')?.click()
      })
      expect(host.textContent).toContain('1 new unsaved')

      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[aria-label="Refresh data"]')?.click()
      })
      expect(host.textContent).not.toContain('unsaved')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.browse = originalBrowse
    }
  })

  test('commits a blank draft as an all-default row', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBrowse = databaseApi.browse.bind(databaseApi)
    const originalBatch = databaseApi.batch.bind(databaseApi)
    const batches: Parameters<typeof databaseApi.batch>[1][] = []
    databaseApi.browse = async () => ({
      columns: [{ name: 'id' }],
      rows: [[1]],
      durationMs: 1,
    })
    databaseApi.batch = async (_connectionId, statements) => {
      batches.push(statements)
      return []
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={schema}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })
      const add = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Add row',
      )
      await act(async () => add?.click())
      await act(async () => {
        host.querySelector<HTMLButtonElement>('button[title="Insert row"]')?.click()
      })
      const commit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Commit',
      )
      await act(async () => commit?.click())

      expect(batches).toEqual([
        [
          {
            sql: 'INSERT INTO "users" DEFAULT VALUES;',
            params: [],
          },
        ],
      ])
      expect(host.textContent).not.toContain('unsaved')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.browse = originalBrowse
      databaseApi.batch = originalBatch
    }
  })
})

/**
 * A table that sets its own `min-width` must live in a box that can SCROLL horizontally, never in one
 * that clips. Every structure pane wrapped its table in `overflow-hidden rounded-md` under a
 * `max-w-*` cap — so in any panel narrower than the table (a split editor group, a narrow window) the
 * last columns were simply cut off: the wrapper clipped them, and the ancestor scroller could not reach
 * past that clipping box, so there was no scrollbar anywhere. Status and the delete button are the
 * rightmost columns of the structure editor, which is what made it unusable rather than merely ugly.
 *
 * Asserted on the CLASS CONTRACT rather than on measured geometry, and labelled as such: jsdom applies
 * no CSS, so `scrollWidth`/`clientWidth` are both 0 here and a layout assertion would be theatre. What
 * regresses is the class on the wrapper, so that is what this reads.
 */
describe('a min-width table is scrollable, not clipped', () => {
  const renderStructure = async (conn: DbConnectionInfo) => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <TableDataWorkspace
          connection={conn}
          target={{ table: 'users' }}
          schema={schema}
          onOpenConsole={() => {}}
          onOpenConsoleWithSql={() => {}}
        />,
      )
    })
    // The view switcher is the real path in: the workspace opens on Data, and there is no prop to
    // preselect Structure. Clicking it is also what a user does.
    const structureTab = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Structure',
    )
    expect(structureTab).toBeDefined()
    await act(async () => {
      structureTab!.click()
    })
    return {
      host,
      cleanup: async () => {
        await act(async () => root.unmount())
        host.remove()
      },
    }
  }

  const assertScrollable = (host: HTMLElement) => {
    const tables = [...host.querySelectorAll('table')].filter((t) =>
      /(^|\s)min-w-\[/.test(t.className),
    )
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) {
      const wrapper = table.parentElement
      expect(wrapper).not.toBeNull()
      const cls = wrapper!.className
      // The precise regression: a clipping wrapper around a min-width table.
      expect(cls).not.toContain('overflow-hidden')
      expect(cls).toContain('overflow-x-auto')
    }
  }

  test('the editable structure editor scrolls its column grid', async () => {
    const r = await renderStructure(connection)
    try {
      assertScrollable(r.host)
    } finally {
      await r.cleanup()
    }
  })

  test('the read-only structure view scrolls too', async () => {
    const r = await renderStructure({ ...connection, readonly: true })
    try {
      assertScrollable(r.host)
    } finally {
      await r.cleanup()
    }
  })
})

/**
 * The header of the structure editor promises: "Changes stay staged until you review the SQL." Two paths
 * broke that promise silently.
 *
 * 1. The view switcher UNMOUNTED `StructureView`, so its `drafts` state died — clicking Data and back
 *    discarded every staged column edit with no warning.
 * 2. `TableStructureEditor` rebuilt its drafts from scratch whenever the `table` OBJECT changed, and a
 *    schema reload fires on every switch into this view (and on the header Refresh, and whenever another
 *    console runs DDL on the same connection). Same silent loss.
 *
 * Neither is recoverable: there is no undo for a discarded draft.
 */
describe('staged column edits survive', () => {
  test('a view switch to Data and back keeps them', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBrowse = databaseApi.browse.bind(databaseApi)
    databaseApi.browse = async () => ({
      columns: [{ name: 'id' }],
      rows: [[1]],
      durationMs: 1,
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={schema}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })
      await act(async () => (await openStructure(host)).click())

      const input = nameInput(host)
      expect(input).not.toBeNull()
      // Edit the column name the way a user does, through the real React handler.
      await act(async () => typeInto(input!, 'identifier'))
      expect(nameInput(host)!.value).toBe('identifier')
      expect(host.textContent).toContain('1 pending')

      // Leave to Data…
      const dataTab = [...host.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Data',
      )
      await act(async () => dataTab!.click())
      // …and come back.
      await act(async () => (await openStructure(host)).click())

      expect(nameInput(host)!.value).toBe('identifier')
      expect(host.textContent).toContain('1 pending')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.browse = originalBrowse
    }
  })

  test('a schema reload that returns the SAME columns keeps them', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    // A fresh object every call — exactly what a reload produces, and what used to reset the drafts.
    const reloadingSchema = {
      ...schema,
      getTable: () => ({ ...table, columns: table.columns.map((column) => ({ ...column })) }),
    } as unknown as SchemaState
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={reloadingSchema}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })
      await act(async () => (await openStructure(host)).click())
      const input = nameInput(host)!
      await act(async () => typeInto(input, 'identifier'))
      expect(host.textContent).toContain('1 pending')

      // Force re-renders; every one hands the editor a NEW table object.
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={reloadingSchema}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })

      expect(nameInput(host)!.value).toBe('identifier')
      expect(host.textContent).toContain('1 pending')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

describe('an unreadable object says so instead of spinning forever', () => {
  /** A connection whose per-object introspection failed: no table, but a reason. */
  const failing = (onReload: (table: string, schema?: string) => void) =>
    ({
      ...schema,
      getTable: () => undefined,
      getTableError: () => 'permission denied for table users',
      reloadTable: onReload,
    }) as unknown as SchemaState

  const render = async (host: HTMLElement, schemaState: SchemaState, view: 'structure' | 'ddl') => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <TableDataWorkspace
          connection={connection}
          target={{ table: 'users' }}
          schema={schemaState}
          onOpenConsole={() => {}}
          onOpenConsoleWithSql={() => {}}
        />,
      )
    })
    const label = view === 'structure' ? 'Structure' : 'DDL'
    const tab = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === label,
    )
    expect(tab).toBeDefined()
    await act(async () => tab!.click())
    return { root, act }
  }

  const retryButton = (host: HTMLElement) =>
    [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Retry')

  for (const view of ['structure', 'ddl'] as const) {
    test(`the ${view} view shows the engine's reason and a working Retry`, async () => {
      const reloaded: Array<[string, string | undefined]> = []
      const host = document.createElement('div')
      document.body.append(host)
      const { root, act } = await render(
        host,
        failing((table, tableSchema) => reloaded.push([table, tableSchema])),
        view,
      )
      try {
        // The reason the read failed, verbatim from the engine — not a spinner, and not a
        // generic message that hides which permission is missing.
        expect(host.textContent).toContain('permission denied for table users')
        expect(host.textContent).not.toContain(
          view === 'structure' ? 'Reading structure…' : 'Reading DDL…',
        )

        // Nothing re-reads an object by itself, so the retry has to be reachable and real.
        const retry = retryButton(host)
        expect(retry).toBeDefined()
        await act(async () => retry!.click())
        expect(reloaded).toEqual([['users', undefined]])
      } finally {
        await act(async () => root.unmount())
        host.remove()
      }
    })
  }

  test('a slow read still shows the spinner — only a FAILED read becomes an error', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const loading = {
      ...schema,
      getTable: () => undefined,
      getTableError: () => undefined,
    } as unknown as SchemaState
    const { root, act } = await render(host, loading, 'structure')
    try {
      expect(host.textContent).toContain('Reading structure…')
      expect(retryButton(host)).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})

describe('a failed apply re-reads the table', () => {
  test('the drafts stay staged and the object is refreshed, not left stale', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    // The apply dialog embeds Monaco, which cannot load in this environment. Restore the
    // export spy below: mock.module replacements survive mock.restore() and affect later suites.
    const codeEditorModule = await import('@localixai/kit/code-editor')
    const originalEditor = codeEditorModule.CodeEditor
    const editor = spyOn(codeEditorModule, 'CodeEditor').mockImplementation(
      ({ value, ariaLabel }) => React.createElement('pre', { 'aria-label': ariaLabel }, value),
    )
    const { TableDataWorkspace } = await import('./TableDataWorkspace')
    const originalBatch = databaseApi.batch.bind(databaseApi)
    databaseApi.batch = async () => {
      throw new Error('Duplicate column name "identifier"')
    }
    const reloaded: Array<[string, string | undefined]> = []
    const state = {
      ...schema,
      reloadTable: (name: string, tableSchema?: string) => reloaded.push([name, tableSchema]),
    } as unknown as SchemaState
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <TableDataWorkspace
            connection={connection}
            target={{ table: 'users' }}
            schema={state}
            onOpenConsole={() => {}}
            onOpenConsoleWithSql={() => {}}
          />,
        )
      })
      await act(async () => (await openStructure(host)).click())
      await act(async () => typeInto(nameInput(host)!, 'identifier'))
      expect(host.textContent).toContain('1 pending')

      const review = [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Review & apply'),
      )
      expect(review).toBeDefined()
      await act(async () => review!.click())
      const apply = [...document.body.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Apply changes'),
      )
      expect(apply).toBeDefined()
      await act(async () => {
        apply!.click()
        await Promise.resolve()
      })

      // DDL is not transactional on every engine, so a rejected batch may have applied part
      // of itself. The table has to be re-read either way, or the editor keeps diffing
      // against a structure that no longer exists and re-offers statements that already ran.
      expect(reloaded).toEqual([['users', undefined]])
      // …and the failure must not silently discard the user's work.
      expect(host.textContent).toContain('1 pending')
      expect(document.body.textContent).toContain('Duplicate column name "identifier"')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      databaseApi.batch = originalBatch
      editor.mockRestore()
      expect(codeEditorModule.CodeEditor).toBe(originalEditor)
    }
  })
})
