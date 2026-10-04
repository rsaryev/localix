import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWriteTool } from './write'
import { createReadTool } from './read'
import { createFileMtimeStore } from './file-utils'
import type { AgentTool } from '@localixai/agent/agents'

/**
 * Run a write call the way the agent loop does: the tool's pre-execute `guard`
 * runs first, and only if it allows does `execute` run. The blind-overwrite refusal
 * now lives in the guard (so it can also fire mid-stream), so the refusal tests must
 * go through this path rather than calling `execute` directly.
 */
async function runGuarded(
  tool: AgentTool,
  id: string,
  input: { path: string; content: string; cwd?: string },
) {
  const verdict = await tool.guard?.({ toolCallId: id, input })
  if (verdict?.block) return verdict.result
  return tool.execute(id, input as never)
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

    const result = await tool.execute('w1', { path: 'new.txt', content: 'hello\nworld\n' })

    expect(result.isError).toBeUndefined()
    expect(await readFile(path.join(tempDir, 'new.txt'), 'utf8')).toBe('hello\nworld\n')
    expect(result.content).toContain('Open in Localix:')
    expect(result.content).toContain('localix://ui/work-item/file?path=')
    expect((result.details as { openUri?: string }).openUri).toContain(
      'localix://ui/work-item/file?path=',
    )
    // The same-directory temp file used for the atomic rename must be gone.
    const entries = await readdir(tempDir)
    expect(entries).toEqual(['new.txt'])
  })

  test('allows overwriting a file this run previously wrote', async () => {
    const tool = createWriteTool(undefined, tempDir)

    const first = await tool.execute('w2a', { path: 'twice.txt', content: 'v1\n' })
    expect(first.isError).toBeUndefined()

    const second = await tool.execute('w2b', { path: 'twice.txt', content: 'v2\n' })
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
    // Round-trip elimination: the error embeds the current content so the model
    // can re-issue the write without a separate read.
    expect(result.content).toContain('<current_file_content>')
    expect(result.content).toContain('precious content')
    // The `edit` tool was removed (file tools = read/search/write/apply_patch); the
    // targeted-change hint must point at apply_patch, never the dead `edit` tool.
    expect(result.content).toContain('apply_patch')
    expect(result.content).not.toMatch(/use edit\b/)
    // File untouched.
    expect(await readFile(filePath, 'utf8')).toBe('precious content\n')
  })

  test('the streamGuard phase blocks a blind overwrite, embeds content, and records mtime so the write then succeeds', async () => {
    const filePath = path.join(tempDir, 'streamed.txt')
    await writeFile(filePath, 'precious\n', 'utf8')
    const tool = createWriteTool(undefined, tempDir)

    // The loop fires streamGuard.evaluate the moment `path` has streamed — with only
    // the partial input (no content body yet), saving the wasted body tokens.
    const verdict = await tool.streamGuard?.evaluate({ path: 'streamed.txt' })
    expect(verdict?.block).toBe(true)
    expect(verdict?.result.isError).toBe(true)
    expect(verdict?.result.content).toContain('<current_file_content>')
    expect(verdict?.result.content).toContain('precious')
    // File untouched by the guard.
    expect(await readFile(filePath, 'utf8')).toBe('precious\n')

    // The guard recorded the mtime, so the model's re-issued write now passes.
    const retry = await runGuarded(tool, 'sg-retry', {
      path: 'streamed.txt',
      content: 'replaced\n',
    })
    expect(retry.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('replaced\n')
  })

  test('after the embedded-content refusal, re-issuing the same write succeeds', async () => {
    const filePath = path.join(tempDir, 'retry.txt')
    await writeFile(filePath, 'old stuff\n', 'utf8')
    const tool = createWriteTool(undefined, tempDir)

    const refused = await runGuarded(tool, 'w3b1', { path: 'retry.txt', content: 'replacement\n' })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('re-issue the SAME write call')

    const retry = await runGuarded(tool, 'w3b2', { path: 'retry.txt', content: 'replacement\n' })
    expect(retry.isError).toBeUndefined()
    expect(await readFile(filePath, 'utf8')).toBe('replacement\n')
  })

  test('embedded content is capped at 16KB with a truncation note and byte size', async () => {
    const filePath = path.join(tempDir, 'big.txt')
    const big = 'x'.repeat(40_000)
    await writeFile(filePath, big, 'utf8')
    const tool = createWriteTool(undefined, tempDir)

    const result = await runGuarded(tool, 'w3c', { path: 'big.txt', content: 'tiny\n' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('truncated: showing first 16384 of 40000 bytes')
    // The snapshot itself is capped.
    const inner = String(result.content).split('<current_file_content>')[1] ?? ''
    expect(inner.length).toBeLessThan(17_000)
    expect(await readFile(filePath, 'utf8')).toBe(big)
  })

  test('allows the overwrite after the file has been read (same session store)', async () => {
    const filePath = path.join(tempDir, 'read-first.txt')
    await writeFile(filePath, 'old content\n', 'utf8')
    // read + write share ONE session-scoped store, exactly as the tool registry
    // builds them. Tools built with separate stores are separate sessions and must
    // NOT see each other's reads (see the sibling test below).
    const mtimes = createFileMtimeStore()
    const readTool = createReadTool(undefined, tempDir, undefined, undefined, undefined, mtimes)
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

    const first = await tool.execute('w5a', { path: 'stale.txt', content: 'v1\n' })
    expect(first.isError).toBeUndefined()

    // Simulate an external change: bump the mtime past the recorded one.
    await utimes(filePath, new Date(), new Date(Date.now() + 5_000))

    const second = await tool.execute('w5b', { path: 'stale.txt', content: 'v2\n' })
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
      payloads.map((content, i) => tool.execute(`w6-${i}`, { path: 'race.txt', content })),
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
    ['a write', { path: 'a.txt', content: 'x' }],
    ['unparseable input', 'not an object'],
  ])('%s reaches files', (_label, input) => {
    expect(createWriteTool(undefined, '/tmp').classify?.(input)).toEqual({ effect: 'files' })
  })
})
