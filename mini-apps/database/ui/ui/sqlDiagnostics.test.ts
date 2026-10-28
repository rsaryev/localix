import { describe, expect, jest, test } from 'bun:test'
import type { MonacoEditorExtension } from '@localixai/kit/code-editor'

type MonacoEditorExtensionContext = Parameters<MonacoEditorExtension['setup']>[0]
import type { DbSchemas, DbTableSchema } from '../dbClient'
import { createSqlCatalog, type SqlCatalog } from '../model/sql-diagnostics/catalog'
import { createSqlDiagnostics } from './sqlDiagnostics'

type Marker = { message: string; severity: number; startColumn: number; endColumn: number }

/** Just enough Monaco for one single-line model: markers keyed by owner. */
function fakeEditor(initial: string) {
  let text = initial
  const listeners: Array<() => void> = []
  const markers = new Map<string, Marker[]>()
  const context = {
    monaco: {
      MarkerSeverity: { Error: 8, Warning: 4 },
      editor: {
        setModelMarkers: (_model: unknown, owner: string, list: Marker[]) =>
          markers.set(owner, list),
      },
    },
    editor: {},
    model: {
      getValue: () => text,
      getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
      onDidChangeContent: (listener: () => void) => (listeners.push(listener), { dispose() {} }),
      isDisposed: () => false,
    },
  } as unknown as MonacoEditorExtensionContext
  const edit = (next: string) => {
    text = next
    for (const listener of listeners) listener()
  }
  return { context, markers, edit }
}

const schemas = { public: [{ name: 'users', type: 'table' }] } as DbSchemas

describe('sqlDiagnostics extension', () => {
  test('marks under its OWN owner, so the host language server markers survive', () => {
    const { context, markers } = fakeEditor('SELECT * FROM usres')
    const catalog = createSqlCatalog(schemas, () => undefined)
    const { extension } = createSqlDiagnostics({
      getCatalog: () => catalog,
      getDialect: () => 'postgres',
      onWantColumns: () => {},
    })
    extension.setup(context)
    const own = markers.get('localix-sql')!
    expect(own).toHaveLength(1)
    expect(own[0]!.severity).toBe(8)
    expect([own[0]!.startColumn, own[0]!.endColumn]).toEqual([15, 20])
    // Only this module's two owners are ever written — never the host's `diagnostics` owner.
    expect([...markers.keys()].sort()).toEqual(['localix-sql', 'localix-sql-run'])
  })

  test('asks for missing columns, and refresh() judges them once they arrive', async () => {
    const { context, markers } = fakeEditor('SELECT u.nmae FROM users u')
    let loaded = false
    const getTable = () =>
      loaded
        ? ({ name: 'users', columns: [{ name: 'name' }] } as unknown as DbTableSchema)
        : undefined
    let catalog: SqlCatalog | null = createSqlCatalog(schemas, getTable)
    const wanted: string[] = []
    const diagnostics = createSqlDiagnostics({
      getCatalog: () => catalog,
      getDialect: () => 'postgres',
      onWantColumns: (tables) => wanted.push(...tables.map((t) => t.name)),
    })
    jest.useFakeTimers()
    const disposable = diagnostics.extension.setup(context) as { dispose(): void }
    expect(markers.get('localix-sql')).toEqual([])
    expect(wanted).toEqual(['users'])

    loaded = true
    catalog = createSqlCatalog(schemas, getTable)
    diagnostics.refresh()
    jest.advanceTimersByTime(300)
    jest.useRealTimers()
    expect(markers.get('localix-sql')!.map((m) => m.message)).toEqual([
      'Column "nmae" does not exist in "users". Did you mean "name"?',
    ])

    disposable.dispose()
    expect(markers.get('localix-sql')).toEqual([])
  })

  test('no dialect (no connection) means no markers at all', () => {
    const { context, markers } = fakeEditor('SELECT * FROM usres')
    const { extension } = createSqlDiagnostics({
      getCatalog: () => createSqlCatalog(schemas, () => undefined),
      getDialect: () => undefined,
      onWantColumns: () => {},
    })
    extension.setup(context)
    expect(markers.get('localix-sql')).toEqual([])
  })

  test('a failed run underlines the name the engine blamed, until that statement is edited', () => {
    const { context, markers, edit } = fakeEditor('SELECT * FROM usres')
    const { extension } = createSqlDiagnostics({
      getCatalog: () => null,
      getDialect: () => 'postgres',
      onWantColumns: () => {},
      getRunFailure: () => ({
        sql: 'SELECT * FROM usres',
        message: 'relation "usres" does not exist',
      }),
    })
    extension.setup(context)
    const run = markers.get('localix-sql-run')!
    expect(run.map((m) => [m.startColumn, m.endColumn, m.message])).toEqual([
      [15, 20, 'relation "usres" does not exist'],
    ])
    // Fixing the typo changes the statement: the failure no longer describes this text.
    edit('SELECT * FROM users')
    expect(markers.get('localix-sql-run')).toEqual([])
  })
})
