import { afterEach, describe, expect, test } from 'bun:test'
import os from 'node:os'
import path from 'node:path'

import { defaultDbFile, localixHome } from './env'
import { defaultMcpOAuthDir } from '../features/mcp/oauth/store'
import { defaultSecretsDir } from '../features/secrets/store'

/**
 * Every `~/.localix` store roots at ONE home, and that home is never cwd-relative.
 *
 * The bug this locks: the documents, Vault key and mcp-oauth stores rooted at
 * `process.env.HOME ?? '.'` while `defaultDbFile()` used `os.homedir()`. `HOME` is a
 * POSIX convention Windows does not set (its home var is `USERPROFILE`), and a
 * service manager can scrub it anywhere — so on those hosts the `'.'` fallback took
 * over. That is not a cwd-relative feature, it is SCATTER: the store lands in
 * whatever directory the process happened to start in, so the same user gets a
 * different store per launch, the db (`os.homedir()`) and its neighbours end up on
 * different roots, and — because two of the three hold the VAULT MASTER KEY and MCP
 * OAUTH TOKENS — key material gets written into whatever project the app was started
 * from, ready to be committed.
 *
 * `os.homedir()` needs no fallback: it reads the OS's own account APIs, so it yields
 * a real absolute home whatever `HOME` says — or does not say.
 */

const HOME = process.env.HOME

afterEach(() => {
  if (HOME === undefined) delete process.env.HOME
  else process.env.HOME = HOME
})

/** The three `~/.localix/<sub>` stores, as (subdir, resolver) pairs. */
const subStores = () =>
  [
    ['vault', defaultSecretsDir()],
    ['mcp-oauth', defaultMcpOAuthDir()],
  ] as const

describe('the ~/.localix home is one rule, on every host', () => {
  test('with HOME UNSET (Windows, a scrubbed service env) no store goes cwd-relative', () => {
    delete process.env.HOME

    const dirs = [path.dirname(defaultDbFile()), ...subStores().map(([, dir]) => dir)]
    for (const dir of dirs) {
      expect(path.isAbsolute(dir)).toBe(true)
      // The defect, precisely: `process.env.HOME ?? '.'` → `./.localix/<sub>`, i.e. a
      // secrets vault (and its master key) inside the directory the process started in.
      expect(dir.startsWith('.')).toBe(false)
      expect(dir.startsWith(process.cwd())).toBe(false)
    }
  })

  test('all four roots hang off the SAME home — db included', () => {
    delete process.env.HOME
    const home = localixHome()
    expect(home).toBe(path.join(os.homedir(), '.localix'))
    expect(path.dirname(defaultDbFile())).toBe(home)
    for (const [sub, dir] of subStores()) {
      expect(dir).toBe(path.join(home, sub))
    }
  })

  test('the home is the OS account home — it cannot be scrubbed OR spoofed via HOME', () => {
    // os.homedir() reads the OS account APIs, not the env: a stripped or hostile HOME
    // moves nothing. (This is exactly what `process.env.HOME` could not promise.)
    const real = localixHome()
    process.env.HOME = '/tmp/localix-home-probe'
    expect(localixHome()).toBe(real)
    delete process.env.HOME
    expect(localixHome()).toBe(real)
  })

  test('the db-adjacent blob stores still follow a moved LOCALIX_DB_FILE', () => {
    // documents/media/tables are blobs belonging to db ROWS — move the db and they
    // move with it. Vault master-key material and OAuth state deliberately do not.
    // The Vault catalog and encrypted payload versions themselves live in SQLite.
    expect(defaultSecretsDir()).toBe(path.join(localixHome(), 'vault'))
    expect(defaultMcpOAuthDir()).toBe(path.join(localixHome(), 'mcp-oauth'))
  })
})
