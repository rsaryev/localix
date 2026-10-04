import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { backendClient } from '@/shared/api/client'
import type { FileContentSearchResult } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'
import { useContentSearch } from './useContentSearch'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const result = (query: string): FileContentSearchResult => ({
  root: '/workspace',
  count: 1,
  truncated: false,
  matches: [
    {
      path: 'src/a.ts',
      line: 1,
      lineText: query,
      matchStart: 0,
      matchEnd: query.length,
    },
  ],
})

type SearchSnapshot = ReturnType<typeof useContentSearch>

async function mountSearch(initialQuery: string) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let current: SearchSnapshot | null = null

  function Harness({ query }: { query: string }) {
    current = useContentSearch({ sessionId: 'session-a', query, enabled: true })
    return null
  }

  const render = (query: string) =>
    act(async () => {
      root.render(<Harness query={query} />)
      await Promise.resolve()
    })

  await render(initialQuery)
  return {
    act,
    render,
    get current(): SearchSnapshot {
      if (!current) throw new Error('search did not mount')
      return current
    },
    waitForDebounce: () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 320))
      }),
    unmount: () => act(async () => root.unmount()),
  }
}

describe('useContentSearch request and mutation ownership', () => {
  test('clearing the query invalidates a request already in flight', async () => {
    const pending = deferred<FileContentSearchResult>()
    const search = spyOn(backendClient, 'searchContent').mockImplementation(
      async () => await pending.promise,
    )
    const hook = await mountSearch('old query')

    try {
      await hook.waitForDebounce()
      expect(search).toHaveBeenCalledTimes(1)
      await hook.render('')
      expect(hook.current.matches).toEqual([])

      await hook.act(async () => {
        pending.resolve(result('old query'))
        await pending.promise
      })
      expect(hook.current.matches).toEqual([])
      expect(hook.current.hasResults).toBe(false)
    } finally {
      await hook.unmount()
      search.mockRestore()
    }
  })

  test('stale displayed hits cannot authorize replace for a newer query', async () => {
    const nextSearch = deferred<FileContentSearchResult>()
    const search = spyOn(backendClient, 'searchContent')
      .mockResolvedValueOnce(result('first'))
      .mockImplementation(async () => await nextSearch.promise)
    const replace = spyOn(backendClient, 'replaceContent').mockResolvedValue({
      filesChanged: 1,
      replacements: 1,
    })
    const hook = await mountSearch('first')

    try {
      await hook.waitForDebounce()
      expect(hook.current.hasResults).toBe(true)

      await hook.render('second')
      expect(hook.current.matches).toHaveLength(1)
      expect(hook.current.hasResults).toBe(false)
      await hook.act(async () => {
        await hook.current.runReplace()
      })
      expect(replace).not.toHaveBeenCalled()
    } finally {
      await hook.unmount()
      replace.mockRestore()
      search.mockRestore()
    }
  })

  test('replace matches ignored-file scope and joins duplicate confirmations', async () => {
    const search = spyOn(backendClient, 'searchContent').mockResolvedValue(result('needle'))
    const pending = deferred<{ filesChanged: number; replacements: number }>()
    const replace = spyOn(backendClient, 'replaceContent').mockImplementation(
      async () => await pending.promise,
    )
    const hook = await mountSearch('needle')

    try {
      await hook.waitForDebounce()
      let first!: Promise<void>
      let duplicate!: Promise<void>
      await hook.act(async () => {
        first = hook.current.runReplace()
        duplicate = hook.current.runReplace()
        await Promise.resolve()
      })

      expect(duplicate).toBe(first)
      expect(replace).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith(
        'session-a',
        'needle',
        '',
        expect.objectContaining({ includeIgnored: true }),
      )

      await hook.act(async () => {
        pending.resolve({ filesChanged: 1, replacements: 1 })
        await first
      })
      // The count answers the click beside the replace field, not as a journal row.
      expect(hook.current.replaceFeedback.getSnapshot()).toMatchObject({
        message: 'Replaced 1 occurrence in 1 file',
        tone: 'success',
      })
    } finally {
      await hook.unmount()
      replace.mockRestore()
      search.mockRestore()
    }
  })
})
