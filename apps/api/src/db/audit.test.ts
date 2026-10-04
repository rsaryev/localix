import { expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'kysely'
import { createDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { auditDatabase } from './audit'

test('audit validates a file without modifying its bytes, permissions, or data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'localix-audit-'))
  const file = join(dir, 'fixture.sqlite')
  try {
    const db = createDatabase({ filename: file })
    try {
      await migrateToLatest(db)
      await sql`INSERT INTO user_profiles (user_id,name) VALUES ('u','Private content')`.execute(db)
    } finally {
      await db.destroy()
    }
    await chmod(file, 0o644)
    const before = await readFile(file)
    const result = await auditDatabase(file)
    expect(result).toMatchObject({
      ok: true,
      integrity: ['ok'],
      foreignKeyViolations: [],
      schemaErrors: [],
    })
    expect(JSON.stringify(result)).not.toContain('Private content')
    expect(await readFile(file)).toEqual(before)
    expect((await stat(file)).mode & 0o777).toBe(0o644)
    const readonly = createDatabase({ filename: file, readonly: true })
    try {
      await expect(sql`DELETE FROM user_profiles`.execute(readonly)).rejects.toThrow('readonly')
    } finally {
      await readonly.destroy()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('audit detects the missing receipt table even when the migration ledger says applied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'localix-audit-drift-'))
  try {
    const file = join(dir, 'fixture.sqlite')
    const db = createDatabase({ filename: file })
    try {
      await migrateToLatest(db)
      await sql`DROP TABLE agent_delivery_receipts`.execute(db)
    } finally {
      await db.destroy()
    }
    const result = await auditDatabase(file)
    expect(result.ok).toBe(false)
    expect(result.integrity).toEqual(['ok'])
    expect(result.schemaErrors.join('\n')).toContain('missing table agent_delivery_receipts')
    const missing = join(dir, 'absent', 'never-created.sqlite')
    await expect(auditDatabase(missing)).rejects.toThrow()
    expect(await Bun.file(missing).exists()).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
