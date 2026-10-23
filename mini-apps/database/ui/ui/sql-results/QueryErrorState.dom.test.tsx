/**
 * What the Database workbench actually shows when a call fails.
 *
 * Reported case: "Query failed" above a monospace card containing the single token
 * `connection_not_found` — the backend had put a machine CODE where the human message goes, and
 * the pane quoted it like a crash dump. There is no card any more: a failure is one host line
 * naming what happened, and the engine's own output is in the Event Center behind it. What still
 * has to hold is the title — it must name what happened, not blame the SQL — and that a stop the
 * user asked for is not reported as a failure at all.
 *
 * And that each console reports under its OWN name: settling resolves every row for one subject, so
 * while they all published "Query failed" two consoles failing at once settled each other.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'
import { useQueryErrorState } from './QueryErrorState'

/** The hook is the surface; a host mounts it the way the results pane does. */
const QueryErrorState = (props: Parameters<typeof useQueryErrorState>[0]) =>
  useQueryErrorState(props)

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
})

async function render(props: Omit<Parameters<typeof QueryErrorState>[0], 'subject'>) {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  const root = createRoot(container)
  await act(async () => root.render(<QueryErrorState subject="shop · orders" {...props} />))
  return {
    container,
    text: () => container.textContent ?? '',
    pre: () => container.querySelector('pre'),
    problems: () => container.querySelectorAll('[role="alert"]').length,
    unmount: async () => {
      await act(async () => root.unmount())
    },
  }
}

describe('a plain application message', () => {
  test('is prose, not a quoted engine dump', async () => {
    const h = await render({
      error: 'That database connection is no longer available — reconnect it, then try again.',
      errorCode: 'connection_not_found',
    })
    try {
      expect(h.text()).toContain('no longer available')
      // The regression, stated: a single sentence must not appear inside the monospace card.
      expect(h.pre()).toBeNull()
    } finally {
      await h.unmount()
    }
  })

  test('says what happened, and never blames the SQL', async () => {
    const h = await render({
      error: 'That database connection is no longer available.',
      errorCode: 'connection_not_found',
    })
    try {
      // The query never reached the engine — blaming the SQL sent the user to the wrong place.
      expect(h.text()).toContain('no longer available')
      expect(h.text()).not.toContain('Query failed')
    } finally {
      await h.unmount()
    }
  })
})

describe('real engine output', () => {
  test('is the headline, without the monospace card', async () => {
    const h = await render({
      error: 'Query failed.',
      errorCode: 'query_failed',
      errorDetail: "Duplicate entry '1' for key 'PRIMARY'",
    })
    try {
      expect(h.text()).toContain('Duplicate entry')
      // The regression, stated: the reason must not be quoted back inside a crash-dump card.
      expect(h.pre()).toBeNull()
      // …and the whole record is one click away, for whoever finds it later.
      expect(h.text()).toContain('Details')
    } finally {
      await h.unmount()
    }
  })

  test('the detail wins over the friendly message — the real reason is what helps', async () => {
    const h = await render({
      error: 'The query failed.',
      errorCode: 'query_failed',
      errorDetail: 'near "SELCT": syntax error',
    })
    try {
      expect(h.text()).toContain('SELCT')
      expect(h.text()).not.toContain('The query failed.')
    } finally {
      await h.unmount()
    }
  })

  test('a driver paragraph is not a headline — the classified sentence takes the line', async () => {
    const wall =
      'connect to the docker API at unix:///Users/someone/.colima/default/docker.sock; ' +
      'check if the path is correct and if the daemon is running: dial unix: connect: no such file'
    const h = await render({
      error: 'The query failed.',
      errorCode: 'query_failed',
      errorDetail: wall,
    })
    try {
      expect(h.text()).toContain('The query failed.')
      // Not truncated onto the line with an ellipsis — never put there in the first place.
      expect(h.text()).not.toContain('dial unix')
      expect(h.text()).toContain('Details')
    } finally {
      await h.unmount()
    }
  })
})

describe('a user-initiated stop', () => {
  test('stays a muted note with no error body at all', async () => {
    // Cancelling is not a failure; this behaviour predates the change and must survive it.
    const h = await render({ error: 'cancelled', errorCode: 'cancelled' })
    try {
      expect(h.text()).toContain('Query stopped')
      expect(h.pre()).toBeNull()
      expect(h.text()).not.toContain('cancelled')
      // Not a failure, so nothing is reported anywhere.
      expect(h.problems()).toBe(0)
    } finally {
      await h.unmount()
    }
  })
})

describe('two consoles failing at once', () => {
  test('own separate subjects, so neither settles the other', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warnings.push(String(args[0]))
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () =>
        root.render(
          <>
            <QueryErrorState subject="shop console" error="Connection refused." />
            <QueryErrorState subject="analytics console" error="Connection refused." />
          </>,
        ),
      )
      // The dev-mode guard names a second owner of one subject; two consoles are two subjects.
      expect(warnings.filter((line) => line.includes('[problem-report]'))).toEqual([])
      await act(async () => root.unmount())
    } finally {
      console.warn = warn
    }
  })
})
