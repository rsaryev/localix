import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import os from 'node:os'
import {
  DEFAULT_MEMORY_CHAR_LIMIT,
  SESSION_MEMORY_CHAR_LIMIT,
  charLimitForScope,
  entriesChars,
  formatUsage,
  memoriesBaseDir,
  memoryFilePath,
  mutateMemoryFile,
  parseMemoryFile,
  readMemoryFile,
  serializeMemoryFile,
  usageOf,
  writeMemoryFile,
} from './file-store'

describe('memoriesBaseDir', () => {
  test('resolves under ~/.localix/memories', () => {
    expect(memoriesBaseDir()).toBe(path.join(os.homedir(), '.localix', 'memories'))
  })
})
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMemoryRepository } from './repository'

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), 'localix-mem-'))
}

describe('memory file format', () => {
  test('serialize → parse round-trips entries with timestamps', () => {
    const entries = [
      { key: 'user_role', value: 'QA Engineer', updatedAt: '2026-06-11T00:00:00.000Z' },
      { key: 'stack', value: 'Bun + Turborepo\nReact 19', updatedAt: '2026-06-11T01:00:00.000Z' },
    ]
    expect(parseMemoryFile(serializeMemoryFile(entries))).toEqual(entries)
  })

  test('parser tolerates hand-edits: preamble, missing timestamps, extra whitespace', () => {
    const text = [
      '# My memory file',
      'some freeform notes the user typed',
      '',
      '## first_key',
      '',
      '  value with leading space  ',
      '',
      '## second_key',
      '<!-- updated: 2026-01-01T00:00:00Z -->',
      'second value',
      '',
      '## empty_key',
      '',
    ].join('\n')
    const entries = parseMemoryFile(text)
    expect(entries).toEqual([
      { key: 'first_key', value: 'value with leading space', updatedAt: undefined },
      { key: 'second_key', value: 'second value', updatedAt: '2026-01-01T00:00:00Z' },
    ])
  })

  test('duplicate keys: first wins', () => {
    const entries = parseMemoryFile('## a\none\n\n## a\ntwo\n')
    expect(entries).toEqual([{ key: 'a', value: 'one', updatedAt: undefined }])
  })

  test('entriesChars ignores updated comments', () => {
    const withTs = [{ key: 'k', value: 'v', updatedAt: '2026-01-01T00:00:00Z' }]
    const withoutTs = [{ key: 'k', value: 'v' }]
    expect(entriesChars(withTs)).toBe(entriesChars(withoutTs))
    expect(entriesChars(withoutTs)).toBe('## k\nv'.length)
  })

  test('usage and formatting', () => {
    expect(usageOf(582, 2200)).toEqual({ chars: 582, limit: 2200, pct: 26 })
    expect(formatUsage(usageOf(1804, 2200))).toBe('82% — 1,804/2,200 chars')
    expect(charLimitForScope('')).toBe(DEFAULT_MEMORY_CHAR_LIMIT)
    expect(charLimitForScope('project-a')).toBe(DEFAULT_MEMORY_CHAR_LIMIT)
    expect(charLimitForScope('session:abc')).toBe(SESSION_MEMORY_CHAR_LIMIT)
  })

  test('memoryFilePath maps scopes; non-default users are namespaced', () => {
    expect(memoryFilePath('/b', 'local-user', '', 'local-user')).toBe('/b/MEMORY.md')
    expect(memoryFilePath('/b', 'local-user', 'proj-1', 'local-user')).toBe('/b/projects/proj-1.md')
    expect(memoryFilePath('/b', 'local-user', 'session:s1', 'local-user')).toBe('/b/sessions/s1.md')
    expect(memoryFilePath('/b', 'other', '', 'local-user')).toBe('/b/users/other/MEMORY.md')
  })

  /**
   * REGRESSION — a crafted userId must not steer memoryFilePath out of its namespace.
   *
   * The store used to sanitize with its own `safeFileSlug`, a fifth copy of the file-key rule
   * whose charset admitted `.`. That one character was the whole bug: `..` survived, and the
   * `path.join` below did what `path.join` does with a `..` segment. It is asserted through the
   * REAL `path.join` on Bun, because a claim about what path.join does with a sanitized segment
   * is only worth what the runtime actually does with it.
   *
   * Fails on the old sanitizer:
   *   userId '..' → '/b/MEMORY.md'        — OUT of users/, onto the DEFAULT user's global memory
   *   userId '.'  → '/b/users/MEMORY.md'  — collapsed onto one file shared by every '.'-ish id
   */
  describe('a crafted userId cannot escape its own memory namespace', () => {
    const USERS = path.join('/b', 'users')
    const escapes = [
      '..',
      '.',
      '../..',
      '../../etc/passwd',
      '/etc/passwd',
      'a/../..',
      '..\\..',
      'x\0/..',
    ]

    for (const userId of escapes) {
      test(JSON.stringify(userId), () => {
        // Every scope, not just the global one — each builds a different path shape.
        for (const scope of ['', 'PRJ-1', 'session:LOCALIX-1']) {
          const file = memoryFilePath('/b', userId, scope, 'local-user')

          // 1. It stays strictly UNDER users/ — never at its root, never above it.
          expect(file.startsWith(`${USERS}${path.sep}`)).toBe(true)
          expect(path.relative(USERS, file).startsWith('..')).toBe(false)

          // 2. And it never lands on the DEFAULT user's tree, which is what '..' reached.
          expect(file).not.toBe(path.join('/b', 'MEMORY.md'))

          // 3. The user segment is one real, non-empty directory — not '.', not '..'.
          const segment = path.relative(USERS, file).split(path.sep)[0]
          expect(segment).toMatch(/^[A-Za-z0-9_-]+$/)
        }
      })
    }

    test('distinct crafted ids do not all collapse onto ONE shared file', () => {
      // The old sanitizer sent both '.' and '..' into the users/ root ('users/MEMORY.md' and
      // '/b/MEMORY.md'); the '.' case gave every dot-ish id the same file.
      const files = escapes.map((u) => memoryFilePath('/b', u, '', 'local-user'))
      expect(new Set(files).size).toBeGreaterThan(1)
    })
  })

  /**
   * The ids this store actually keys on — `PRJ-<n>`, `LOCALIX-<n>`, and the UUIDs still on disk
   * from the older id scheme — are FIXED POINTS of the SDK's `safeFileKey` rule. Adopting it
   * therefore renames nothing: it is the identity function on every id the system can mint,
   * which is why the fix orphans no file already written under the old sanitizer.
   */
  test('real id shapes are unchanged by the key rule (adopting the owner orphans nothing)', () => {
    expect(memoryFilePath('/b', 'local-user', 'PRJ-3', 'local-user')).toBe('/b/projects/PRJ-3.md')
    expect(memoryFilePath('/b', 'local-user', 'session:LOCALIX-926', 'local-user')).toBe(
      '/b/sessions/LOCALIX-926.md',
    )
    const uuid = '39bb3a86-315e-4dac-a90c-6d8e60b94afa'
    expect(memoryFilePath('/b', 'local-user', uuid, 'local-user')).toBe(`/b/projects/${uuid}.md`)
    expect(memoryFilePath('/b', 'local-user', `session:${uuid}`, 'local-user')).toBe(
      `/b/sessions/${uuid}.md`,
    )
  })

  test('writeMemoryFile is atomic (no leftover temp files) and read-back matches', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'MEMORY.md')
    const entries = [{ key: 'k', value: 'v', updatedAt: '2026-01-01T00:00:00Z' }]
    // Concurrent writes serialize: last one wins.
    await Promise.all([
      writeMemoryFile(file, [{ key: 'k', value: 'old' }]),
      writeMemoryFile(file, entries),
    ])
    expect(await readMemoryFile(file)).toEqual(entries)
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  test('mutateMemoryFile serializes concurrent read-modify-writes (no lost update)', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'MEMORY.md')
    // Two concurrent mutations each ADD a distinct key. With a read OUTSIDE the
    // queue both would read [] and the second would clobber the first; serialized,
    // the second reads the first's write and BOTH keys survive.
    const add = (k: string, v: string) =>
      mutateMemoryFile(file, (entries) => ({
        entries: [...entries, { key: k, value: v }],
        result: undefined,
      }))
    await Promise.all([add('a', '1'), add('b', '2')])
    const keys = (await readMemoryFile(file)).map((e) => e.key).sort()
    expect(keys).toEqual(['a', 'b'])
  })

  test('mutateMemoryFile with null entries skips the write (no spurious file)', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'MEMORY.md')
    const r = await mutateMemoryFile(file, () => ({ entries: null, result: 'noop' as const }))
    expect(r).toBe('noop')
    expect(existsSync(file)).toBe(false)
  })

  test('a throwing mutate fn rejects but does not poison the next mutation', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'MEMORY.md')
    await mutateMemoryFile(file, (e) => ({
      entries: [...e, { key: 'ok', value: '1' }],
      result: undefined,
    }))
    const boom = mutateMemoryFile(file, () => {
      throw new Error('budget')
    })
    expect(boom).rejects.toThrow('budget')
    // The next mutation still works and sees the prior good write.
    await mutateMemoryFile(file, (e) => ({
      entries: [...e, { key: 'ok2', value: '2' }],
      result: undefined,
    }))
    expect((await readMemoryFile(file)).map((e) => e.key).sort()).toEqual(['ok', 'ok2'])
  })

  test('readMemoryFile on a missing file returns []', async () => {
    expect(await readMemoryFile(path.join(await tempDir(), 'nope.md'))).toEqual([])
  })
})

describe('file-backed repository migration', () => {
  test('legacy agent_memory rows migrate into files once; DB rows are kept', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const now = '2026-06-11T00:00:00.000Z'
    await db
      .insertInto('agent_memory')
      .values([
        {
          id: '1',
          user_id: 'local-user',
          project_id: '',
          key: 'name',
          value: 'Ada',
          created_at: now,
          updated_at: now,
        },
        {
          id: '2',
          user_id: 'local-user',
          project_id: 'proj-1',
          key: 'deploy',
          value: 'fly.io',
          created_at: now,
          updated_at: now,
        },
      ])
      .execute()

    const baseDir = await tempDir()
    const repo = createMemoryRepository(db, { baseDir, defaultUserId: 'local-user' })
    const notes = await repo.list('local-user', ['', 'proj-1'], 'key')
    expect(notes).toEqual([
      { key: 'deploy', value: 'fly.io', projectId: 'proj-1' },
      { key: 'name', value: 'Ada', projectId: '' },
    ])

    expect(await readFile(path.join(baseDir, 'MEMORY.md'), 'utf8')).toContain('## name')
    expect(existsSync(path.join(baseDir, '.migrated'))).toBe(true)
    // DB rows untouched.
    const rows = await db.selectFrom('agent_memory').selectAll().execute()
    expect(rows).toHaveLength(2)
  })

  test('migration is skipped when MEMORY.md already exists', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const now = '2026-06-11T00:00:00.000Z'
    await db
      .insertInto('agent_memory')
      .values([
        {
          id: '1',
          user_id: 'local-user',
          project_id: '',
          key: 'stale',
          value: 'from-db',
          created_at: now,
          updated_at: now,
        },
      ])
      .execute()

    const baseDir = await tempDir()
    await mkdir(baseDir, { recursive: true })
    await writeFile(path.join(baseDir, 'MEMORY.md'), '## fresh\nfrom-file\n', 'utf8')

    const repo = createMemoryRepository(db, { baseDir, defaultUserId: 'local-user' })
    const notes = await repo.list('local-user', [''], 'key')
    expect(notes).toEqual([{ key: 'fresh', value: 'from-file', projectId: '' }])
  })

  test('usage aggregates chars and limits across scopes', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const repo = createMemoryRepository(db, {
      baseDir: await tempDir(),
      defaultUserId: 'local-user',
    })
    await repo.set('local-user', '', 'a', 'global note', '2026-06-11T00:00:00.000Z')
    await repo.set('local-user', 'session:s1', 'b', 'session note', '2026-06-11T00:00:00.000Z')

    const usage = await repo.usage('local-user', ['', 'session:s1'])
    expect(usage.limit).toBe(DEFAULT_MEMORY_CHAR_LIMIT + SESSION_MEMORY_CHAR_LIMIT)
    expect(usage.chars).toBe('## a\nglobal note'.length + '## b\nsession note'.length)
  })

  test('list order "recent" sorts by updated timestamp desc', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const repo = createMemoryRepository(db, {
      baseDir: await tempDir(),
      defaultUserId: 'local-user',
    })
    await repo.set('local-user', '', 'older', 'v1', '2026-06-10T00:00:00.000Z')
    await repo.set('local-user', '', 'newer', 'v2', '2026-06-11T00:00:00.000Z')

    const notes = await repo.list('local-user', [''], 'recent')
    expect(notes.map((n) => n.key)).toEqual(['newer', 'older'])
  })
})
