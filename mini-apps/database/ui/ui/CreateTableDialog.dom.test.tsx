import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import type { DbConnectionInfo } from '../dbClient'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await teardown()
})

const connection = (id: string, dialect: DbConnectionInfo['dialect']): DbConnectionInfo => ({
  id,
  name: id,
  dialect,
  connected: true,
  readonly: false,
  createdAt: 1,
})
const settle = () => turns()

describe('create-table draft scope', () => {
  test('keeps an edited column mounted when an earlier row is removed', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CreateTableDialog } = await import('./CreateTableDialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <CreateTableDialog
            open
            connection={connection('sqlite', 'sqlite')}
            schemas={[]}
            onOpenChange={() => {}}
            onOpenSql={() => {}}
          />,
        )
      })

      const inputs = document.body.querySelectorAll<HTMLInputElement>(
        'input[placeholder="column_name"]',
      )
      const editedInput = inputs[1]
      const removeFirst = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove id"]',
      )
      expect(editedInput).toBeDefined()
      expect(removeFirst).not.toBeNull()

      editedInput?.focus()
      expect(document.activeElement).toBe(editedInput)
      await act(async () => {
        removeFirst?.click()
      })

      const remaining = document.body.querySelectorAll<HTMLInputElement>(
        'input[placeholder="column_name"]',
      )
      expect(remaining).toHaveLength(1)
      expect(remaining[0]).toBe(editedInput)
      expect(remaining[0]?.value).toBe('name')
      expect(document.activeElement).toBe(editedInput)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  test('resets table, schema and data types when the connection changes', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { CreateTableDialog } = await import('./CreateTableDialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    const render = (current: DbConnectionInfo, initialSchema?: string) =>
      root.render(
        <CreateTableDialog
          open
          connection={current}
          schemas={initialSchema ? [initialSchema] : []}
          initialSchema={initialSchema}
          onOpenChange={() => {}}
          onOpenSql={() => {}}
        />,
      )

    try {
      await act(async () => render(connection('postgres', 'postgres'), 'tenant'))
      const table = document.body.querySelector<HTMLInputElement>('input[placeholder="customers"]')
      await act(async () => {
        // Keep the generated SQL invalid so this form-state regression does not mount the
        // real Monaco preview (its Vite worker loader is outside Bun's DOM environment).
        for (const column of document.body.querySelectorAll<HTMLInputElement>(
          'input[placeholder="column_name"]',
        )) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            column,
            '',
          )
          column.dispatchEvent(new Event('input', { bubbles: true }))
        }
        if (table) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            table,
            'orders',
          )
          table.dispatchEvent(new Event('input', { bubbles: true }))
        }
        await settle()
      })
      const postgresType = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Column 1 data type"]',
      )
      await act(async () => {
        postgresType?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerType: 'mouse',
          }),
        )
        await settle()
      })
      const uuid = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.trim() === 'uuid',
      )
      await act(async () => {
        uuid?.click()
        await settle()
      })
      expect(table?.value).toBe('orders')
      expect(postgresType?.textContent).toContain('uuid')

      await act(async () => render(connection('sqlite', 'sqlite')))

      expect(
        document.body.querySelector<HTMLInputElement>('input[placeholder="customers"]')?.value,
      ).toBe('')
      expect(
        [
          ...document.body.querySelectorAll<HTMLButtonElement>('button[aria-label$="data type"]'),
        ].map((trigger) => trigger.textContent?.trim()),
      ).toEqual(['INTEGER', 'TEXT'])
      expect(document.body.textContent).not.toContain('tenant')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
