import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectStatus } from './status'
import { computeChangeVersion } from './change-version'
import { gitRunner, type GitRunner } from './cli'

// A Cyrillic word ("file") built from code points: the source stays English, the path non-ASCII.
const NON_ASCII = String.fromCodePoint(0x0444, 0x0430, 0x0439, 0x043b)

describe('collectStatus line deltas', () => {
  test('a Cyrillic filename and a staged rename carry their real counts', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'status-numstat-'))
    const run = gitRunner(repo)
    const runOk = async (args: string[]) => {
      const res = await run(args)
      if (!res.ok) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
    }
    try {
      await runOk(['init', '-q'])
      await runOk(['config', 'user.email', 'test@example.com'])
      await runOk(['config', 'user.name', 'Test'])
      await runOk(['config', 'commit.gpgsign', 'false'])
      await writeFile(join(repo, `${NON_ASCII}.txt`), 'a\nb\nc\n')
      await writeFile(join(repo, 'asset.custom'), '\0base')
      await writeFile(join(repo, 'old name.ts'), 'one\ntwo\nthree\nfour\n')
      await runOk(['add', '.'])
      await runOk(['commit', '-qm', 'base'])

      await writeFile(join(repo, 'asset.custom'), '\0changed')
      await writeFile(join(repo, `${NON_ASCII}.txt`), 'a\nB\nc\nd\n')
      await runOk(['mv', 'old name.ts', 'new name.ts'])
      await writeFile(join(repo, 'new name.ts'), 'one\ntwo\nthree\nfour\nfive\n')
      await runOk(['add', 'new name.ts'])

      const status = await collectStatus(run, repo)
      const byPath = new Map(status.files.map((file) => [file.path, file]))
      expect(byPath.get('asset.custom')).toMatchObject({
        binary: true,
        insertions: 0,
        deletions: 0,
      })
      expect(byPath.get(`${NON_ASCII}.txt`)).toMatchObject({ insertions: 2, deletions: 1 })
      expect(byPath.get('new name.ts')).toMatchObject({
        status: 'renamed',
        oldPath: 'old name.ts',
        insertions: 1,
        deletions: 0,
      })
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

/**
 * The panel refreshes on the workspace watcher's signal, and that watcher reports `.git`. A plain
 * `git status` rewrites `.git/index` after refreshing stale stat data, so each read would have
 * produced the change event that schedules the next read.
 */
describe('collectStatus never writes the index', () => {
  test('a touched-but-unchanged file leaves .git/index byte-identical', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'status-optional-locks-'))
    const run = gitRunner(repo)
    const runOk = async (args: string[]) => {
      const res = await run(args)
      if (!res.ok) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
    }
    try {
      await runOk(['init', '-q'])
      await runOk(['config', 'user.email', 'test@example.com'])
      await runOk(['config', 'user.name', 'Test'])
      await runOk(['config', 'commit.gpgsign', 'false'])
      await writeFile(join(repo, 'kept.ts'), 'a\n')
      await runOk(['add', '.'])
      await runOk(['commit', '-qm', 'base'])
      // Same bytes, new mtime: exactly the stale stat a refreshing `status` writes back.
      await utimes(join(repo, 'kept.ts'), 1_600_000_000, 1_600_000_000)
      const before = await readFile(join(repo, '.git', 'index'))

      const status = await collectStatus(run, repo)

      expect(status.files).toEqual([])
      expect((await readFile(join(repo, '.git', 'index'))).equals(before)).toBe(true)
      // Positive control: the same read WITH optional locks does rewrite it, so the assertion
      // above is measuring something.
      await runOk(['status', '--porcelain'])
      expect((await readFile(join(repo, '.git', 'index'))).equals(before)).toBe(false)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

describe('computeChangeVersion', () => {
  test('changes after a same-size rewrite with different mtime', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'source-control-version-'))
    const path = join(dir, 'same-size.ts')
    const files = [
      {
        path: 'same-size.ts',
        status: 'modified' as const,
        staged: false,
        unstaged: true,
        insertions: 1,
        deletions: 1,
      },
    ]
    try {
      await writeFile(path, 'before')
      await utimes(path, 1_700_000_000, 1_700_000_000)
      const before = await computeChangeVersion(dir, files)

      await writeFile(path, 'after!')
      await utimes(path, 1_700_000_001, 1_700_000_001)
      const after = await computeChangeVersion(dir, files)

      expect(after).not.toBe(before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('changes when partial staging changes but working-file metadata does not', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'source-control-index-version-'))
    const path = join(dir, 'partially-staged.ts')
    const files = [
      {
        path: 'partially-staged.ts',
        status: 'modified' as const,
        staged: true,
        unstaged: true,
        insertions: 2,
        deletions: 1,
      },
    ]
    try {
      await writeFile(path, 'same working tree')
      await utimes(path, 1_700_000_000, 1_700_000_000)

      const first = await computeChangeVersion(dir, files, ':100644 100644 aaa bbb M\0file\0')
      const second = await computeChangeVersion(dir, files, ':100644 100644 aaa ccc M\0file\0')

      expect(second).not.toBe(first)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('real partial-index rewrite invalidates context with an unchanged working file', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'source-control-partial-index-'))
    const blobs = await mkdtemp(join(tmpdir(), 'source-control-index-blobs-'))
    const run = gitRunner(repo)
    const file = join(repo, 'partial.ts')
    const fixedTime = 1_700_000_000
    const runOk = async (args: string[]) => {
      const result = await run(args)
      expect(result.ok).toBe(true)
      return result.stdout.trim()
    }
    const installIndexBlob = async (name: string, content: string) => {
      const source = join(blobs, name)
      await writeFile(source, content)
      const hash = await runOk(['hash-object', '-w', '--', source])
      await runOk(['update-index', '--add', '--cacheinfo', '100644', hash, 'partial.ts'])
    }

    try {
      await runOk(['init', '-q'])
      await runOk(['config', 'user.email', 'test@example.com'])
      await runOk(['config', 'user.name', 'Test'])
      // The developer machine may globally enable GPG signing; this fixture is
      // about index identity and must never launch pinentry or depend on a key.
      await runOk(['config', 'commit.gpgsign', 'false'])
      await writeFile(file, 'a\nb\nc\n')
      await runOk(['add', 'partial.ts'])
      await runOk(['commit', '-qm', 'base'])

      // The working file stays byte-for-byte and mtime-for-mtime identical while
      // the index switches between two different partial versions. Porcelain
      // remains MM and working-tree numstat remains identical in both snapshots.
      await writeFile(file, 'A\nB\nC\n')
      await utimes(file, fixedTime, fixedTime)
      await installIndexBlob('first.ts', 'A\nb\nc\n')
      const first = await collectStatus(run, repo)

      await installIndexBlob('second.ts', 'a\nB\nc\n')
      const second = await collectStatus(run, repo)

      expect(first.files).toEqual(second.files)
      expect(first.files[0]).toMatchObject({ staged: true, unstaged: true })
      expect(second.changeVersion).not.toBe(first.changeVersion)
    } finally {
      await Promise.all([
        rm(repo, { recursive: true, force: true }),
        rm(blobs, { recursive: true, force: true }),
      ])
    }
  })
})

/**
 * The status read runs for every discovered repo on every poll tick, and each
 * git spawn costs ~10 ms whatever it is asked, so its process count is a budget
 * worth defending in a test rather than rediscovering in a profiler.
 */
describe('collectStatus process budget', () => {
  const setup = async () => {
    const repo = await mkdtemp(join(tmpdir(), 'status-budget-'))
    const raw = gitRunner(repo)
    const calls: string[][] = []
    const run: GitRunner = (args, ...rest) => {
      calls.push(args)
      return raw(args, ...rest)
    }
    const runOk = async (args: string[]) => {
      const res = await raw(args)
      if (!res.ok) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
    }
    await runOk(['init', '-q'])
    await runOk(['config', 'user.email', 'test@example.com'])
    await runOk(['config', 'user.name', 'Test'])
    await runOk(['config', 'commit.gpgsign', 'false'])
    await writeFile(join(repo, 'kept.ts'), 'a\n')
    await runOk(['add', '.'])
    await runOk(['commit', '-qm', 'base'])
    return { repo, run, calls }
  }

  test('a CLEAN tree costs two invocations — status and the shared rev-parse', async () => {
    const { repo, run, calls } = await setup()
    try {
      calls.length = 0
      const status = await collectStatus(run, repo)

      expect(calls).toHaveLength(2)
      expect(calls.map((c) => c[0]).sort()).toEqual(['rev-parse', 'status'])
      // Nothing was skipped that the caller depends on.
      expect(status.root).toBeTruthy()
      expect(status.branch).toBeTruthy()
      expect(status.files).toEqual([])
      expect(status.changeVersion).toBeTruthy()
      expect(status.rebase).toBeUndefined()
      expect(status.bisect).toBeUndefined()
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test('a DIRTY tree adds exactly the two diffs it actually needs', async () => {
    const { repo, run, calls } = await setup()
    try {
      await writeFile(join(repo, 'kept.ts'), 'a\nb\n')
      calls.length = 0
      const status = await collectStatus(run, repo)

      expect(calls).toHaveLength(4)
      expect(calls.filter((c) => c[0] === 'diff')).toHaveLength(2)
      expect(status.files).toHaveLength(1)
      expect(status.stats.insertions).toBe(1)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})
