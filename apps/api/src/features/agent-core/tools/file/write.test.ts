import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWriteTool, type WriteToolDetails, type WriteToolInput } from './write'
import { createReadTool } from './read'
import { createFileMtimeStore } from './file-utils'
import type { AgentTool } from '@localixai/agent/agents'

/** A one-file call in the advertised batch shape. */
const one = (path: string, content: string) => ({ files: [{ path, content }] })

/**
 * Run a write call the way the agent loop does: the tool's pre-execute `guard`
 * runs first, and only if it allows does `execute` run. The blind-overwrite refusal
 * lives in the guard, so the refusal tests must go through this path rather than
 * calling `execute` directly.
 */
async function runGuarded(
  tool: AgentTool<WriteToolInput, WriteToolDetails>,
  id: string,
  input: { path: string; content: string; cwd?: string } | WriteToolInput,
) {
  const call: WriteToolInput =
    'files' in input ? input : { ...one(input.path, input.content), cwd: input.cwd }
  const verdict = await tool.guard?.({ toolCallId: id, input: call })
  if (verdict?.block) return verdict.result
  return tool.execute(id, call)
}

describe('createWriteTool', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-write-'))
  })

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('creates a new file and leaves no temp artifacts (atomic write)', async () => {
    const tool = createWriteTool(undefined, tempDir)

    const result = await tool.execute('w1', one('new.txt', 'hello\nworld\n'))

    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'new.txt'), 'utf8')).toBe('hello\nworld\n')
    expect(result.content).toContain('Open in Localix:')
    expect(result.content).toContain('localix://ui/work-item/file?path=')
    expect(result.details?.files[0]?.openUri).toContain('localix://ui/work-item/file?path=')
    // The same-directory temp file used for the atomic rename must be gone.
    const entries = await readdir(tempDir)
    expect(entries).toEqual(['new.txt'])
  })

  test('allows overwriting a file this run previously wrote', async () => {
    const tool = createWriteTool(undefined, tempDir)

    const first = await tool.execute('w2a', one('twice.txt', 'v1\n'))
    expect(first.isError).toBeUndefined()

    const second = await tool.execute('w2b', one('twice.txt', 'v2\n'))
    expect(second.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'twice.txt'), 'utf8')).toBe('v2\n')
  })

  test('refuses a blind overwrite of an existing file never read this run', async () => {
    const filePath = path.join(tempDir, 'unread.txt')
    await writeFile(filePath, 'precious content\n', 'utf8')
    const tool = createWriteTool(undefined, tempDir)

    const result = await runGuarded(tool, 'w3', { path: 'unread.txt', content: 'gone\n' })

    expect(result.isError).toBe(true)
    expect(result.error?.retryable).toBe(true)
    expect(result.content).toContain('has not been read')
    // The guard runs before the permission gate, so it never hands back the file's content.
    expect(result.content).not.toContain('precious content')
    // The targeted-change hint points at `edit`, never the removed patch tool.
    expect(result.content).toContain('use `Edit` for targeted changes')
    expect(result.content).not.toContain('apply_patch')
    // File untouched.
    expect(await readFile(filePath, 'utf8')).toBe('precious content\n')
  })

  test('a batch with one unread existing file is refused whole, and succeeds once it is read', async () => {
    const unread = path.join(tempDir, 'unread.txt')
    await writeFile(unread, 'precious\n', 'utf8')
    const mtimes = createFileMtimeStore()
    const readTool = createReadTool(undefined, tempDir, undefined, undefined, mtimes)
    const tool = createWriteTool(undefined, tempDir, undefined, undefined, mtimes)
    const call = {
      files: [
        { path: 'fresh.txt', content: 'new\n' },
        { path: 'unread.txt', content: 'replaced\n' },
      ],
    }

    const refused = await runGuarded(tool, 'wb1', call)
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('unread.txt')
    expect(refused.content).not.toContain('precious')
    // Pre-flight: nothing of the batch was written, not even the new file.
    expect(await readdir(tempDir)).toEqual(['unread.txt'])

    // The refusal recorded nothing as read: the same call is refused again.
    expect((await runGuarded(tool, 'wb2', call)).isError).toBe(true)

    // Once the file has been read, the re-issued call passes and writes both files.
    expect((await readTool.execute('wb3', { path: 'unread.txt' })).isError).toBeUndefined()
    const retry = await runGuarded(tool, 'wb4', call)
    expect(retry.isError).toBeUndefined()
    expect(await readFile(unread, 'utf8')).toBe('replaced\n')
    expect(await readFile(path.join(tempDir, 'fresh.txt'), 'utf8')).toBe('new\n')
  })

  test('allows the overwrite after the file has been read (same session store)', async () => {
    const filePath = path.join(tempDir, 'read-first.txt')
    await writeFile(filePath, 'old content\n', 'utf8')
    // read + write share ONE session-scoped store, exactly as the tool registry
    // builds them. Tools built with separate stores are separate sessions and must
    // NOT see each other's reads (see the sibling test below).
    const mtimes = createFileMtimeStore()
    const readTool = createReadTool(undefined, tempDir, undefined, undefined, mtimes)
    const writeTool = createWriteTool(undefined, tempDir, undefined, undefined, mtimes)

    const read = await readTool.execute('w4a', { path: 'read-first.txt' })
    expect(read.isError).toBeUndefined()

    const result = await runGuarded(writeTool, 'w4b', {
      path: 'read-first.txt',
      content: 'new content\n',
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('new content\n')
  })

  test("another session's read does not unlock this session's blind-overwrite guard", async () => {
    const filePath = path.join(tempDir, 'cross-session.txt')
    await writeFile(filePath, 'old content\n', 'utf8')
    const readTool = createReadTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      createFileMtimeStore(),
    )
    const writeTool = createWriteTool(
      undefined,
      tempDir,
      undefined,
      undefined,
      createFileMtimeStore(),
    )

    await readTool.execute('x1', { path: 'cross-session.txt' })
    const result = await runGuarded(writeTool, 'x2', {
      path: 'cross-session.txt',
      content: 'clobber\n',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('has not been read')
    expect(await readFile(filePath, 'utf8')).toBe('old content\n')
  })

  test('refuses to overwrite a file that changed on disk since the last tool touch', async () => {
    const filePath = path.join(tempDir, 'stale.txt')
    const tool = createWriteTool(undefined, tempDir)

    const first = await tool.execute('w5a', one('stale.txt', 'v1\n'))
    expect(first.isError).toBeUndefined()

    // Simulate an external change: bump the mtime past the recorded one.
    await utimes(filePath, new Date(), new Date(Date.now() + 5_000))

    const second = await tool.execute('w5b', one('stale.txt', 'v2\n'))
    expect(second.isError).toBe(true)
    expect(second.error?.retryable).toBe(true)
    expect(second.content).toContain('changed on disk')
    expect(await readFile(filePath, 'utf8')).toBe('v1\n')
  })

  test('serializes concurrent writes to the same path (mutation queue)', async () => {
    const tool = createWriteTool(undefined, tempDir)

    // Fire several writes at once; the per-path queue must serialize them so the
    // file ends as exactly one of the complete payloads (content integrity).
    const payloads = ['one\n', 'two\n', 'three\n', 'four\n']
    await Promise.all(
      payloads.map((content, i) => tool.execute(`w6-${i}`, one('race.txt', content))),
    )

    const final = await readFile(path.join(tempDir, 'race.txt'), 'utf8')
    expect(payloads).toContain(final)
    expect((await readdir(tempDir)).filter((e) => e.endsWith('.tmp'))).toEqual([])
  })
})

/**
 * `createDirectories` was declared in the schema and never read: `atomicWriteFile` unconditionally calls
 * `ensureParentDir`. So a model that passed `false` precisely to avoid materialising a mistyped tree —
 * `write {path:'src/compnents/Foo.tsx', createDirectories:false}` — got the directory created anyway AND a
 * plain success back. A field the schema invites you to set and the code ignores is a documented
 * capability that silently is not one.
 */
describe('createWriteTool — createDirectories', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'localix-write-cd-'))
  })
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('false REFUSES when the parent does not exist, and creates nothing', async () => {
    const tool = createWriteTool(undefined, dir)
    const res = await tool.execute('w1', {
      path: 'compnents/Foo.tsx',
      content: 'x',
      create_directories: false,
    } as never)
    expect(res.isError).toBe(true)
    expect(String(res.content)).toContain('parent directory does not exist')
    // The whole point: the typo'd tree is NOT on disk.
    expect(await readdir(dir)).toEqual([])
  })

  test('false still writes when the parent already exists', async () => {
    const tool = createWriteTool(undefined, dir)
    const res = await tool.execute('w2', {
      path: 'ok.txt',
      content: 'hello',
      create_directories: false,
    } as never)
    expect(res.isError).toBeUndefined()
    expect(await readFile(path.join(dir, 'ok.txt'), 'utf8')).toBe('hello')
  })

  test('the default is unchanged — parents are created', async () => {
    const tool = createWriteTool(undefined, dir)
    const res = await tool.execute('w3', { path: 'a/b/c.txt', content: 'deep' } as never)
    expect(res.isError).toBeUndefined()
    expect(await readFile(path.join(dir, 'a/b/c.txt'), 'utf8')).toBe('deep')
  })
})

describe('write classification', () => {
  test.each([
    ['a write', { files: [{ path: 'a.txt', content: 'x' }] }],
    ['a historical single-file write', { path: 'a.txt', content: 'x' }],
    ['unparseable input', 'not an object'],
  ])('%s reaches files', (_label, input) => {
    expect(createWriteTool(undefined, '/tmp').classify?.(input)).toEqual({ effect: 'files' })
  })
})

describe('createWriteTool — batches', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'localix-write-batch-'))
  })
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('writes every file of one call and reports each', async () => {
    const tool = createWriteTool(undefined, dir)
    const result = await tool.execute('wb', {
      files: [
        { path: 'a.txt', content: 'a\n' },
        { path: 'nested/b.txt', content: 'bb\n' },
      ],
    })
    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('a\n')
    expect(await readFile(path.join(dir, 'nested/b.txt'), 'utf8')).toBe('bb\n')
    expect(result.content).toContain(`Wrote 2 bytes to ${path.join(dir, 'a.txt')}`)
    expect(result.content).toContain(`Wrote 3 bytes to ${path.join(dir, 'nested/b.txt')}`)
    expect(result.details?.files.map((f) => [f.path, f.created, f.failed])).toEqual([
      [path.join(dir, 'a.txt'), true, undefined],
      [path.join(dir, 'nested/b.txt'), true, undefined],
    ])
  })

  test('a stale file fails alone: the others are written and the result names it', async () => {
    const tool = createWriteTool(undefined, dir)
    const stale = path.join(dir, 'stale.txt')
    await tool.execute('wb1', one('stale.txt', 'v1\n'))
    await utimes(stale, new Date(), new Date(Date.now() + 5_000))

    const result = await tool.execute('wb2', {
      files: [
        { path: 'stale.txt', content: 'v2\n' },
        { path: 'fresh.txt', content: 'ok\n' },
      ],
    })
    // Partly applied is not an error: the fresh file IS on disk.
    expect(result.isError).toBeUndefined()
    expect(await readFile(stale, 'utf8')).toBe('v1\n')
    expect(await readFile(path.join(dir, 'fresh.txt'), 'utf8')).toBe('ok\n')
    expect(result.content).toContain('Not changed — ')
    expect(result.content).toContain('changed on disk')
    expect(result.content).toContain('1 of 2 files failed')
    expect(result.details?.files[0]).toMatchObject({ path: stale, failed: true })
    expect(result.details?.files[1]?.failed).toBeUndefined()
  })

  test('a call whose every file fails is an error that still lists the files', async () => {
    const tool = createWriteTool(undefined, dir)
    const result = await tool.execute('wb3', {
      files: [
        { path: 'x/a.txt', content: 'a' },
        { path: 'y/b.txt', content: 'b' },
      ],
      create_directories: false,
    })
    expect(result.isError).toBe(true)
    expect(result.details?.files.every((f) => f.failed)).toBe(true)
    expect(await readdir(dir)).toEqual([])
  })

  test('the same file twice in one call is refused before anything is written', async () => {
    const tool = createWriteTool(undefined, dir)
    const result = await tool.execute('wb4', {
      files: [
        { path: 'a.txt', content: '1' },
        { path: './a.txt', content: '2' },
      ],
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('listed twice')
    expect(await readdir(dir)).toEqual([])
  })

  test('scopes the call by every file it names', () => {
    const tool = createWriteTool(undefined, '/ws')
    const input = {
      files: [
        { path: 'a.txt', content: '' },
        { path: '/elsewhere/b.txt', content: '' },
      ],
    }
    expect(tool.parallelScopePaths?.(input)).toEqual(['/ws/a.txt', '/elsewhere/b.txt'])
  })
})
