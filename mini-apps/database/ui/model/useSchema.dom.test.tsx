import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { SchemaState } from './useSchema'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

describe('useSchema work-item visibility', () => {
  test('a parked consumer neither discovers schemas nor loads table details', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { databaseApi } = await import('../api/databaseApi')
    const { useSchema } = await import('./useSchema')

    const originalSchemas = databaseApi.schemas.bind(databaseApi)
    const originalTableSchema = databaseApi.tableSchema.bind(databaseApi)
    let schemaCalls = 0
    let tableCalls = 0
    databaseApi.schemas = async () => {
      schemaCalls += 1
      return {}
    }
    databaseApi.tableSchema = async (_connectionId, table) => {
      tableCalls += 1
      return {
        name: table,
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }
    }

    let state: SchemaState | undefined
    function Reader() {
      const latest = useSchema('visibility-hook-connection')
      React.useEffect(() => {
        state = latest
      })
      return null
    }
    function Harness({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Reader />
        </WorkItemVisibilityProvider>
      )
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Harness visible={false} />))
      expect(schemaCalls).toBe(0)

      await act(async () => state?.loadTable('users'))
      expect(tableCalls).toBe(0)

      await act(async () => {
        root.render(<Harness visible />)
        await settle()
      })
      expect(schemaCalls).toBe(1)

      await act(async () => {
        state?.loadTable('users')
        await settle()
      })
      expect(tableCalls).toBe(1)

      await act(async () => root.render(<Harness visible={false} />))
      await act(async () => state?.reload())
      expect(schemaCalls).toBe(1)
    } finally {
      await act(async () => root.unmount())
      databaseApi.schemas = originalSchemas
      databaseApi.tableSchema = originalTableSchema
    }
  })
})
