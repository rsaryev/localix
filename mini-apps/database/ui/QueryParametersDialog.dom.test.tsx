import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import type { SqlConsoleState } from './model/useSqlConsole'

let teardown: () => Promise<void>
let originalFetch: typeof fetch

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  originalFetch = globalThis.fetch
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await teardown()
})

describe('query parameter run gate', () => {
  test('prompts before execution, binds safely and remembers values for the next run', async () => {
    const requests: Array<{ sql: string; params?: unknown[] }> = []
    globalThis.fetch = (async (_input, init) => {
      // `databaseApi.query` goes through `postJson`, which always sets a JSON STRING body.
      // Assert that instead of `String(init?.body)`: `BodyInit` is a union, and stringifying
      // a non-string member yields "[object Object]", which `JSON.parse` would then reject
      // with a confusing SyntaxError far from the cause. This fails loudly at the cause.
      const body = init?.body
      if (typeof body !== 'string')
        throw new TypeError(`expected a JSON string body, got ${typeof body}`)
      requests.push(JSON.parse(body) as { sql: string; params?: unknown[] })
      return new Response(
        JSON.stringify({
          result: { columns: [{ name: 'id' }], rows: [[1]], durationMs: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch

    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { useSqlConsole } = await import('./model/useSqlConsole')
    const { QueryParametersDialog } = await import('./ui/QueryParametersDialog')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    localStorage.clear()
    let state: SqlConsoleState | null = null

    function Harness() {
      const current = useSqlConsole('primary', { dialect: 'postgres' })
      React.useEffect(() => {
        state = current
      })
      return <QueryParametersDialog console={current} />
    }

    try {
      await act(async () => root.render(<Harness />))
      let firstRun!: Promise<boolean>
      await act(async () => {
        firstRun = state!.runSql(
          'SELECT * FROM users WHERE email = ? AND team = :team AND owner_id = $3',
        )
        await Promise.resolve()
      })

      expect(requests).toHaveLength(0)
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
      expect(dialog?.textContent).toContain('Query parameters')
      expect(dialog?.textContent).toContain('They stay available in this console')

      const email = dialog?.querySelector<HTMLInputElement>('[aria-label="Value for ?1"]')
      const team = dialog?.querySelector<HTMLInputElement>('[aria-label="Value for :team"]')
      const owner = dialog?.querySelector<HTMLInputElement>('[aria-label="Value for $3"]')
      expect(email).not.toBeNull()
      expect(team).not.toBeNull()
      expect(owner).not.toBeNull()

      await act(async () => {
        const setNativeValue = (input: HTMLInputElement | null | undefined, value: string) => {
          if (!input) return
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            value,
          )
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        setNativeValue(email, 'ada@example.com')
        setNativeValue(team, 'core')
        setNativeValue(owner, '42')
      })
      await act(async () => {
        ;[...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
          .find((button) => button.textContent?.trim() === 'Run query')
          ?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(await firstRun).toBe(true)
      expect(requests).toEqual([
        {
          sql: 'SELECT * FROM users WHERE email = $1 AND team = $2 AND owner_id = $3',
          params: ['ada@example.com', 'core', 42],
        },
      ])

      let secondRun!: Promise<boolean>
      await act(async () => {
        secondRun = state!.runSql('SELECT * FROM users WHERE email = ?')
        await Promise.resolve()
      })
      const secondDialog = document.body.querySelector<HTMLElement>('[role="dialog"]')
      expect(
        secondDialog?.querySelector<HTMLInputElement>('[aria-label="Value for ?1"]')?.value,
      ).toBe('ada@example.com')
      await act(async () => {
        ;[...(secondDialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
          .find((button) => button.textContent?.trim() === 'Cancel')
          ?.click()
      })
      expect(await secondRun).toBe(false)
      expect(requests).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      localStorage.clear()
    }
  })
})
