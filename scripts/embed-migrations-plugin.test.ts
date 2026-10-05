import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  embeddedMigrationsPlugin,
  embeddedMigrationsSource,
  listMigrations,
} from './embed-migrations-plugin.mjs'

const migrations = resolve(import.meta.dir, '..', 'apps', 'api', 'migrations')
const scratch = mkdtempSync(join(tmpdir(), 'embed-migrations-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe('listMigrations', () => {
  test('lists every migration file in the API, oldest first, with its text', () => {
    const files = readdirSync(migrations).filter((file) => file.endsWith('.ts'))
    const listed = listMigrations(migrations)
    expect(listed.map((entry) => `${entry.name}.ts`)).toEqual([...files].sort())
    expect(listed.length).toBeGreaterThan(10)
    expect(listed.every((entry) => entry.source.includes('export async function up'))).toBe(true)
  })

  test('refuses a code file the migrator would have run but the bundle would drop', () => {
    const dir = join(scratch, 'misnamed')
    mkdirSync(dir)
    writeFileSync(join(dir, '20260101T000000_ok.ts'), 'export async function up() {}\n')
    writeFileSync(join(dir, 'fix-later.ts'), 'export async function up() {}\n')
    expect(() => listMigrations(dir)).toThrow('fix-later.ts is not named <timestamp>_<name>.ts')
  })

  test('ignores non-code files such as the README', () => {
    const dir = join(scratch, 'with-readme')
    mkdirSync(dir)
    writeFileSync(join(dir, 'README.md'), '# notes')
    writeFileSync(join(dir, '20260101T000000_ok.ts'), 'export async function up() {}\n')
    expect(listMigrations(dir).map((entry) => entry.name)).toEqual(['20260101T000000_ok'])
  })
})

describe('the embedded module', () => {
  test('keys each migration by name and carries its exact text as a string literal', () => {
    const text = embeddedMigrationsSource([
      { name: '20260101T000000_a', path: '/x/a.ts', source: 'line "one"\nline two\n' },
    ])
    expect(text).toContain('import * as migration0 from "/x/a.ts"')
    expect(text).toContain(
      '"20260101T000000_a": { migration: migration0, source: "line \\"one\\"\\nline two\\n" }',
    )
  })

  test('bundles into a file that runs from a folder with no node_modules above it', async () => {
    const entry = join(scratch, 'entry.ts')
    writeFileSync(
      entry,
      "import { EMBEDDED_MIGRATIONS } from 'localix:embedded-migrations'\n" +
        'console.log(JSON.stringify(Object.entries(EMBEDDED_MIGRATIONS).map(' +
        '([name, m]) => [name, typeof m.migration.up, m.source.length > 0])))\n',
    )
    const out = join(scratch, 'out')
    const result = await Bun.build({
      entrypoints: [entry],
      target: 'bun',
      outdir: out,
      naming: { entry: 'bundle.js' },
      plugins: [embeddedMigrationsPlugin(migrations)],
    })
    expect(result.success).toBe(true)
    // Outside the checkout `kysely` cannot resolve from a parent `node_modules`: the bundle is
    // self-contained, or this process fails on the migrations' `import 'kysely'`.
    const run = Bun.spawnSync([process.execPath, join(out, 'bundle.js')], {
      cwd: scratch,
      timeout: 30_000,
      killSignal: 'SIGKILL',
    })
    expect(run.stderr.toString()).toBe('')
    const rows = JSON.parse(run.stdout.toString()) as Array<[string, string, boolean]>
    expect(rows.map(([name]) => name)).toEqual(
      listMigrations(migrations).map((entry) => entry.name),
    )
    expect(rows.every(([, up, hasSource]) => up === 'function' && hasSource)).toBe(true)
  })

  test('fails the build when there is nothing to embed', async () => {
    const empty = join(scratch, 'empty')
    mkdirSync(empty)
    const entry = join(scratch, 'empty-entry.ts')
    writeFileSync(entry, "import 'localix:embedded-migrations'\n")
    await expect(
      Bun.build({
        entrypoints: [entry],
        target: 'bun',
        outdir: join(scratch, 'empty-out'),
        plugins: [embeddedMigrationsPlugin(empty)],
      }),
    ).rejects.toThrow()
  })
})
