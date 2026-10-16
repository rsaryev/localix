import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * The UI reads every API response through a type that comes from the route, so renaming a field in
 * a route is a type error where the UI reads it. That used to be a hand-written `T` at 130 call
 * sites, cast onto whatever JSON arrived (`unwrap<{ toggles: Toggle[] }>(...)`), and renaming
 * `toggles` to `switches` compiled cleanly in the UI and failed at runtime.
 *
 * Reading a route through `client.rpc...` and `unwrap(...)` is the whole contract. This keeps the two
 * ways around it out: a type argument on `unwrap`, and a raw `fetch` to an `/rpc/` URL, which the
 * API's types cannot see. The one raw call left is the file upload, whose request body is bytes the
 * typed client cannot send; its answer is still read as the route's own type.
 */
const root = resolve(import.meta.dir, '..')
const UI_SRC = join(root, 'apps', 'ui', 'src')
const internal = 'apps/ui/src/shared/api/internal.ts'

/** Files that may call `apiFetch` on an `/rpc/` URL themselves. Add one only with the reason. */
const RAW_RPC_FETCH = ['apps/ui/src/shared/api/media-client.ts']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/u.test(entry) && !/\.test\.tsx?$/u.test(entry) ? [path] : []
  })
}

const files = sourceFiles(UI_SRC)
  .map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }))
  .filter(({ path }) => path !== internal)

const TYPE_ARGUMENT = /\bunwrap(?:As)?\s*</u
const UNCHECKED_READER = /\bunwrapAs\b/u
const RAW_RPC = /apiFetch\(\s*`?[^)]*\/rpc\//u

describe('the UI reads API responses through the route types', () => {
  test('nothing hand-writes a type argument for unwrap', () => {
    expect(files.filter(({ text }) => TYPE_ARGUMENT.test(text)).map(({ path }) => path)).toEqual([])
  })

  test('there is no unchecked reader to fall back on', () => {
    expect(files.filter(({ text }) => UNCHECKED_READER.test(text)).map(({ path }) => path)).toEqual(
      [],
    )
  })

  test('only the listed files fetch an /rpc/ URL themselves', () => {
    const raw = files.filter(({ text }) => RAW_RPC.test(text)).map(({ path }) => path)
    expect(raw.sort()).toEqual([...RAW_RPC_FETCH].sort())
  })

  test('the patterns it looks for match what they are meant to catch', () => {
    expect(TYPE_ARGUMENT.test('await unwrap<{ toggles: string[] }>(await client.x.$get())')).toBe(
      true,
    )
    expect(TYPE_ARGUMENT.test('await unwrapAs<Foo>(response)')).toBe(true)
    expect(TYPE_ARGUMENT.test('await unwrap(await client.x.$get())')).toBe(false)
    expect(UNCHECKED_READER.test('unwrapAs(response)')).toBe(true)
    expect(RAW_RPC.test('await apiFetch(`${API_BASE_URL}/rpc/secrets`, { method: "GET" })')).toBe(
      true,
    )
    expect(RAW_RPC.test("await apiFetch('http://x/rpc/y')")).toBe(true)
    expect(RAW_RPC.test('await client.rpc.secrets.$get()')).toBe(false)
  })
})
