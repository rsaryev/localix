import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { CLAUDE_CODE_PLUGIN_MANIFEST } from './import-claude-code'
import { migrateLegacyPluginInstalls } from './legacy-install-migration'

let root: string
let db: ReturnType<typeof createDatabase>
const logs: Array<{ level: string; fields: object }> = []
const logger = {
  info: (fields: object) => logs.push({ level: 'info', fields }),
  warn: (fields: object) => logs.push({ level: 'warn', fields }),
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'plugin-migrate-'))
  db = createDatabase()
  await migrateToLatest(db)
  logs.length = 0
})
afterEach(async () => {
  await destroyDatabase(db)
  await fs.rm(root, { recursive: true, force: true })
})

async function ccPlugin(dir: string, name: string): Promise<void> {
  await fs.mkdir(dirname(join(dir, CLAUDE_CODE_PLUGIN_MANIFEST)), { recursive: true })
  await fs.writeFile(join(dir, CLAUDE_CODE_PLUGIN_MANIFEST), JSON.stringify({ name }))
}

const exists = (p: string) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

describe('migrateLegacyPluginInstalls', () => {
  it('moves Default-project installs to global, re-scopes their rows, and converts them', async () => {
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    await db
      .insertInto('projects')
      .values({
        id: 'PRJ-1',
        user_id: 'u1',
        name: 'Default',
        working_dir: workspace,
        settings: null,
      })
      .execute()
    await db
      .insertInto('capability_source')
      .values({
        id: 'src-1',
        user_id: 'u1',
        kind: 'plugin',
        project_id: 'PRJ-1',
        name: 'typescript-lsp',
        created_at: 'now',
        updated_at: 'now',
      })
      .execute()
    await ccPlugin(join(workspace, '.localix', 'plugins', 'typescript-lsp'), 'typescript-lsp')

    const run = () =>
      migrateLegacyPluginInstalls({ db, homeDir: home, logger, defaultProjectDir: workspace })
    await run()

    const moved = join(home, '.localix', 'plugins', 'typescript-lsp')
    expect(await exists(join(moved, 'plugin.json'))).toBe(true)
    // Nothing is deleted: the original manifest stays beside the native one.
    expect(await exists(join(moved, CLAUDE_CODE_PLUGIN_MANIFEST))).toBe(true)
    expect(await exists(join(workspace, '.localix', 'plugins', 'typescript-lsp'))).toBe(false)
    const row = await db
      .selectFrom('capability_source')
      .select('project_id')
      .where('id', '=', 'src-1')
      .executeTakeFirstOrThrow()
    expect(row.project_id).toBe('')
    const native = JSON.parse(await fs.readFile(join(moved, 'plugin.json'), 'utf8'))
    expect(native.origin.format).toBe('claude-code')

    // Idempotent: a second boot changes nothing and logs nothing new.
    const before = logs.length
    await run()
    expect(logs.length).toBe(before)
  })

  it('converts Claude Code layouts in real project roots in place', async () => {
    const project = join(root, 'repo')
    await db
      .insertInto('projects')
      .values({ id: 'PRJ-2', user_id: 'u1', name: 'Repo', working_dir: project, settings: null })
      .execute()
    const plugin = join(project, '.localix', 'plugins', 'cc')
    await ccPlugin(plugin, 'cc')
    await migrateLegacyPluginInstalls({
      db,
      homeDir: join(root, 'home'),
      logger,
      defaultProjectDir: join(root, 'workspace'),
    })
    expect(await exists(join(plugin, 'plugin.json'))).toBe(true)
  })

  it('leaves a Default-project copy in place when the global root has that name', async () => {
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    await ccPlugin(join(workspace, '.localix', 'plugins', 'dup'), 'dup')
    await fs.mkdir(join(home, '.localix', 'plugins', 'dup'), { recursive: true })
    await migrateLegacyPluginInstalls({ db, homeDir: home, logger, defaultProjectDir: workspace })
    expect(await exists(join(workspace, '.localix', 'plugins', 'dup'))).toBe(true)
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
  })
})
