import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import dagre from 'dagre'
import { registerDom } from '@localixai/kit/testing'
import type { DbTableSchema } from '../dbClient'
import { useDiagramGraph } from './useDiagramGraph'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const detail = (name: string, refTable?: string): DbTableSchema => ({
  name,
  type: 'table',
  columns: [{ name: 'id', dataType: 'integer', nullable: false, pk: true }],
  primaryKey: ['id'],
  foreignKeys: refTable ? [{ columns: ['id'], refTable, refColumns: ['id'] }] : [],
  indexes: [],
})

const objects = [
  { name: 'users', schema: 'public' },
  { name: 'orders', schema: 'public' },
]
const tables: Record<string, DbTableSchema> = {
  users: detail('users'),
  orders: detail('orders', 'users'),
}

describe('useDiagramGraph', () => {
  it('does not re-run the dagre layout when its owner re-renders with the same inputs', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const layout = spyOn(dagre, 'layout')
    const seen: unknown[] = []
    // What `useSchema` hands out: a getTable that is stable until the cached structures change.
    const getTable = (name: string) => tables[name]
    function Probe({ tick }: { tick: number }) {
      const graph = useDiagramGraph({
        objects,
        getTable,
        focusedId: null,
        query: '',
        direction: 'LR',
      })
      seen.push(graph.nodes)
      return <span>{tick}</span>
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<Probe tick={0} />))
      await act(async () => root.render(<Probe tick={1} />))
      await act(async () => root.render(<Probe tick={2} />))

      // The old memo keyed on the whole `SchemaState`, rebuilt every render: three renders were
      // three full layouts. Stable inputs mean one layout and the SAME node array each time.
      expect(layout).toHaveBeenCalledTimes(1)
      expect(seen[1]).toBe(seen[0])
      expect(seen[2]).toBe(seen[0])
    } finally {
      layout.mockRestore()
      await act(async () => root.unmount())
    }
  })

  it('lays out again once the structures it reads change', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const layout = spyOn(dagre, 'layout')
    let nodeCount = -1
    function Probe({ getTable }: { getTable: (name: string) => DbTableSchema | undefined }) {
      const graph = useDiagramGraph({
        objects,
        getTable,
        focusedId: null,
        query: '',
        direction: 'LR',
      })
      React.useEffect(() => {
        nodeCount = graph.nodes.length
      })
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(<Probe getTable={(name) => (name === 'users' ? tables.users : undefined)} />),
      )
      expect(nodeCount).toBe(1)
      await act(async () => root.render(<Probe getTable={(name) => tables[name]} />))
      expect(nodeCount).toBe(2)
      expect(layout).toHaveBeenCalledTimes(2)
    } finally {
      layout.mockRestore()
      await act(async () => root.unmount())
    }
  })
})
