import { describe, expect, test } from 'bun:test'
import { commitReplacePlans } from './file-search'
import { applyReplace, buildReplaceRegExp } from './search-replace'

const run = (text: string, query: string, replacement: string, opts = {}) => {
  const re = buildReplaceRegExp(query, opts)!
  return applyReplace(text, re, replacement, !(opts as { regex?: boolean }).regex)
}

describe('buildReplaceRegExp', () => {
  test('literal query escapes regex metacharacters', () => {
    expect(run('a.b a.b axb', 'a.b', 'X')).toEqual({ text: 'X X axb', count: 2 })
  })

  test('smart-case: lowercase query is case-insensitive', () => {
    expect(run('Foo foo FOO', 'foo', 'bar').count).toBe(3)
  })

  test('smart-case: an uppercase letter makes it case-sensitive', () => {
    expect(run('Foo foo', 'Foo', 'bar')).toEqual({ text: 'bar foo', count: 1 })
  })

  test('caseSensitive forces exact case', () => {
    expect(run('foo Foo', 'foo', 'x', { caseSensitive: true }).count).toBe(1)
  })

  test('wholeWord only matches standalone words', () => {
    expect(run('cat category cat', 'cat', 'dog', { wholeWord: true })).toEqual({
      text: 'dog category dog',
      count: 2,
    })
  })

  test('malformed regex → null', () => {
    expect(buildReplaceRegExp('(', { regex: true })).toBeNull()
  })
})

describe('applyReplace', () => {
  test('regex mode expands capture references', () => {
    expect(run('foo=1 bar=2', '(\\w+)=(\\d+)', '$2:$1', { regex: true })).toEqual({
      text: '1:foo 2:bar',
      count: 2,
    })
  })

  test('literal mode keeps $ literal in the replacement', () => {
    expect(run('price here', 'price', '$price')).toEqual({ text: '$price here', count: 1 })
  })

  test('no matches leaves text untouched', () => {
    expect(run('hello', 'zzz', 'x')).toEqual({ text: 'hello', count: 0 })
  })
})

describe('commitReplacePlans', () => {
  const plans = [
    { path: '/a', before: 'old a', after: 'new a', replacements: 2 },
    { path: '/b', before: 'old b', after: 'new b', replacements: 1 },
  ]

  test('reports totals only after every prepared file commits', async () => {
    const writes: string[] = []
    const result = await commitReplacePlans(plans, async (path, content) => {
      writes.push(`${path}:${content}`)
    })

    expect(result).toEqual({ filesChanged: 2, replacements: 3 })
    expect(writes).toEqual(['/a:new a', '/b:new b'])
  })

  test('rolls earlier files back when a later write fails', async () => {
    const writes: string[] = []
    const failure = new Error('second write failed')

    // Explicit try/catch rather than `await expect(...).rejects`: bun types that chain as
    // non-thenable, so `lint` (typescript/await-thenable) rejects the await — and dropping the await
    // would let the test finish before the assertion ran, which is a weaker test, not a fixed lint.
    // This form awaits a real promise and asserts on what it threw.
    const rejection = await commitReplacePlans(plans, async (path, content) => {
      writes.push(`${path}:${content}`)
      if (path === '/b') throw failure
    }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(rejection).toBe(failure)
    expect(writes).toEqual(['/a:new a', '/b:new b', '/a:old a'])
  })

  test('surfaces a partial-replace error when a safe rollback also conflicts', async () => {
    const rejection = await commitReplacePlans(plans, async (path, content) => {
      if (path === '/b' || content === 'old a') throw new Error('conflict')
    }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(rejection).toMatchObject({
      status: 409,
      code: 'replace_partial',
      message: expect.stringContaining('/a'),
    })
  })
})
