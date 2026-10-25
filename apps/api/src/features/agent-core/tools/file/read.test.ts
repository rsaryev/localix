import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReadTool, tryListDirectory } from './read'
import { prepareReadArguments, readToolInputSchema } from './read-input'
import { MAX_DIR_ENTRIES } from './read-output'
import type { ExecutionEnvironment } from '../environment'

describe('createReadTool', () => {
  let tempDir = ''

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'localix-read-'))
  })

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  })

  test('a Claude Code read (file_path, a line offset and limit) returns those lines', async () => {
    const file = path.join(tempDir, 'lines.txt')
    await writeFile(file, Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join('\n'), 'utf8')
    const tool = createReadTool(undefined, tempDir)
    const input = readToolInputSchema.parse(
      prepareReadArguments({ file_path: file, offset: 5, limit: 3 }),
    )
    const result = await tool.execute('cc', input)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('row 5')
    expect(result.content).toContain('row 7')
    expect(result.content).not.toContain('row 4')
    expect(result.content).not.toContain('row 8')
  })

  test('publishes the same detail object it returns for successful and failed reads', async () => {
    await writeFile(path.join(tempDir, 'published.txt'), 'read content', 'utf8')
    const tool = createReadTool(undefined, tempDir)
    for (const [name, status] of [
      ['published.txt', 'available'],
      ['missing.txt', 'failed'],
    ] as const) {
      const updates: unknown[] = []
      const result = await tool.execute(name, { path: name }, undefined, (details) => {
        updates.push(details)
      })
      expect(updates).toHaveLength(1)
      expect(updates[0]).toBe(result.details)
      expect(result.sources?.[0]).toMatchObject({ kind: 'file', role: 'consulted', status })
      expect(result.details).toBeDefined()
      expect(result.content).toBe(result.details!.output)
    }
  })

  test('byte-offset truncation and continuation never split a multi-byte character', async () => {
    // 30k check marks = 90,000 bytes of 3-byte UTF-8 chars; 64,000 is NOT a
    // multiple of 3, so naive slicing would cut through a character at both the
    // tail of the first read and the head of the continuation.
    const content = '✓'.repeat(30_000)
    const filePath = path.join(tempDir, 'multibyte.txt')
    await writeFile(filePath, content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const first = await tool.execute('r1', { path: 'multibyte.txt' })
    expect(first.isError).toBeUndefined()
    expect(first.details?.truncated).toBe(true)
    expect(first.content).not.toContain('�')

    // Continue from the suggested offset — it must land on a char boundary.
    const offsetMatch = /byte_offset=(\d+)/.exec(first.content)
    expect(offsetMatch).not.toBeNull()
    const offset = Number(offsetMatch![1])
    expect(offset % 3).toBe(0) // 3-byte chars: a boundary is a multiple of 3

    const second = await tool.execute('r2', { path: 'multibyte.txt', byte_offset: offset })
    expect(second.isError).toBeUndefined()
    expect(second.content).not.toContain('�')
    // No characters lost across the seam: the two slices cover the whole file.
    expect(second.content).toContain('✓')
  })

  test('returns a notice for a binary file instead of garbage bytes', async () => {
    const filePath = path.join(tempDir, 'data.bin')
    // PNG-ish header with an embedded NUL byte → binary by the git heuristic.
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a, 0x42, 0x43]))
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('rb', { path: 'data.bin' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Binary file')
    expect(result.content).toContain('NUL byte')
  })

  test('a misaligned explicit offset is backed up to the previous char boundary', async () => {
    const content = '✓'.repeat(100)
    const filePath = path.join(tempDir, 'aligned.txt')
    await writeFile(filePath, content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    // Offset 4 points into the middle of the second character (bytes 3-5).
    const result = await tool.execute('r3', { path: 'aligned.txt', byte_offset: 4 })
    expect(result.isError).toBeUndefined()
    expect(result.content).not.toContain('�')
    // Backed up to byte 3 → 99 complete characters remain.
    expect(result.content).toContain('✓'.repeat(99))
  })

  test('startLine/endLine returns exactly the requested line-numbered span', async () => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
    await writeFile(path.join(tempDir, 'lines.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r4', { path: 'lines.txt', start_line: 3, end_line: 5 })
    expect(res.isError).toBeUndefined()
    expect(res.content).toContain('[') // header names the range
    expect(res.content).toContain('lines 3-5 of 10')
    expect(res.content).toContain('3\tline 3')
    expect(res.content).toContain('5\tline 5')
    // Only the requested span — neighbours excluded.
    expect(res.content).not.toContain('line 2')
    expect(res.content).not.toContain('line 6')
  })

  test('startLine without endLine reads to end of file', async () => {
    const content = Array.from({ length: 6 }, (_, i) => `L${i + 1}`).join('\n')
    await writeFile(path.join(tempDir, 'tail.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r5', { path: 'tail.txt', start_line: 5 })
    expect(res.content).toContain('lines 5-6 of 6')
    expect(res.content).toContain('5\tL5')
    expect(res.content).toContain('6\tL6')
    expect(res.content).not.toContain('\tL4')
  })

  test('a trailing newline does not add a phantom final line to the count or output', async () => {
    // "a\nb\nc\n" is 3 lines; split('\n') yields a 4th empty element that must be
    // dropped so the count/numbering match ripgrep and no empty "4<tab>" line renders.
    await writeFile(path.join(tempDir, 'trailing.txt'), 'a\nb\nc\n', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r8', { path: 'trailing.txt', start_line: 1 })
    expect(res.content).toContain('lines 1-3 of 3') // not "of 4"
    expect(res.content).toContain('3\tc')
    expect(res.content).not.toContain('4\t') // no phantom empty 4th line
  })

  test('an over-cap line range truncates and advises continuing with startLine (not offset)', async () => {
    // 3000 lines × ~70 bytes ≈ 210KB, well over the 64KB read cap.
    const content = Array.from({ length: 3000 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join(
      '\n',
    )
    await writeFile(path.join(tempDir, 'big.txt'), content, 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r7', { path: 'big.txt', start_line: 1, end_line: 3000 })
    expect(res.isError).toBeUndefined()
    expect(res.details?.truncated).toBe(true)
    // Continuation advice must point at startLine — a line-range read ignores offset.
    expect(res.content).toMatch(/Continue with start_line=\d+/)
    expect(res.content).not.toContain('byte_offset=')
    // The advised next line is the one right after the last shown line.
    const m = /start_line=(\d+)/.exec(res.content)
    expect(m).not.toBeNull()
    const next = Number(m![1])
    expect(next).toBeGreaterThan(1)
    expect(res.content).toContain(`${next - 1}\t`) // last shown line is numbered
    expect(res.content).not.toContain(`${next}\tline ${next}`) // next line withheld
  })

  test('startLine past EOF returns a clear notice, not an empty box', async () => {
    await writeFile(path.join(tempDir, 'small.txt'), 'a\nb\nc', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const res = await tool.execute('r6', { path: 'small.txt', start_line: 99 })
    expect(res.content).toContain('only 3 lines')
    expect(res.content).toContain('start_line=99')
  })

  test('a second identical read returns the full content again', async () => {
    // The agent always gets the real bytes: a repeat read is never answered with a pointer
    // at an earlier result the model may no longer hold.
    await writeFile(path.join(tempDir, 'again.txt'), 'hello world', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const first = await tool.execute('a1', { path: 'again.txt' })
    const second = await tool.execute('a2', { path: 'again.txt' })
    expect(first.content).toContain('hello world')
    expect(second.content).toBe(first.content)
    expect(second.details).toMatchObject({ bytes: 11, truncated: false, output: 'hello world' })
  })

  test('a repeated line range returns the same span again', async () => {
    await writeFile(path.join(tempDir, 'range.txt'), 'a\nb\nc\nd\ne\n', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const first = await tool.execute('r1', { path: 'range.txt', start_line: 2, end_line: 3 })
    const second = await tool.execute('r2', { path: 'range.txt', start_line: 2, end_line: 3 })
    expect(first.content).toContain('b')
    expect(second.content).toBe(first.content)
  })

  test('a file changed between reads returns its new content', async () => {
    const file = path.join(tempDir, 'chg.txt')
    await writeFile(file, 'v1', 'utf8')
    const tool = createReadTool(undefined, tempDir)
    await tool.execute('c1', { path: 'chg.txt' })
    await writeFile(file, 'v2', 'utf8')
    expect((await tool.execute('c2', { path: 'chg.txt' })).content).toContain('v2')
  })

  test('a line range applies to an extracted document, not just to plain text', async () => {
    // `attachment-spill`'s manifest tells the model to read a spilled .docx with
    // startLine/endLine. The document branch used to return before the range code,
    // handing back the WHOLE extraction while the model believed it got lines 2-3.
    const docPath = path.join(tempDir, 'report.docx')
    await writeFile(docPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])) // NUL byte ⇒ "binary"
    const extractor = async () => 'alpha\nbeta\ngamma\ndelta'
    const tool = createReadTool(undefined, tempDir, undefined, extractor)

    const whole = await tool.execute('d1', { path: 'report.docx' })
    expect(whole.content).toContain('alpha')
    expect(whole.content).toContain('delta')

    const slice = await tool.execute('d2', { path: 'report.docx', start_line: 2, end_line: 3 })
    expect(slice.content).toContain('beta')
    expect(slice.content).toContain('gamma')
    expect(slice.content).not.toContain('delta')
  })

  /**
   * `read` publishes provenance for what it put in front of the model.
   *
   * Before this the answer's Sources list meant "web links from research": the tool that pulls the
   * MOST context into a coding session published nothing at all, so the list could never answer
   * "what did the agent actually look at".
   */
  test('a successful read publishes a CONSULTED file source at an openable URI', async () => {
    const filePath = path.join(tempDir, 'a.ts')
    await writeFile(filePath, 'export const a = 1\n', 'utf8')
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('tc-src', { path: filePath } as never)

    expect(result.sources).toHaveLength(1)
    expect(result.sources?.[0]).toMatchObject({
      kind: 'file',
      title: 'a.ts',
      role: 'consulted',
      status: 'available',
    })
    // The workbench already registers this URI (`FileTab.surface.ts`), which is what makes the
    // row clickable without one line of new navigation.
    expect(result.sources?.[0]?.uri).toBe(
      `localix://ui/work-item/file?path=${encodeURIComponent(filePath)}`,
    )
  })

  test('a FAILED read still publishes, marked failed', async () => {
    // "We tried to look at this and could not" is part of what informed the answer. The answer UI
    // hides `failed` records; the tool card keeps them. Publishing nothing would lose it entirely.
    const tool = createReadTool(undefined, tempDir)

    const result = await tool.execute('tc-miss', {
      path: path.join(tempDir, 'nope.ts'),
    } as never)

    expect(result.isError).toBe(true)
    expect(result.sources?.[0]).toMatchObject({ kind: 'file', status: 'failed' })
  })
})

/**
 * End-to-end filesystem behaviour: relative-cwd resolution, the directory listing,
 * the not-found error, and the byte cap. (Lived in a second read.test.ts at the
 * feature root, orphaned when the tool moved into tools/file/.)
 */
describe('createReadTool — filesystem basics', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
  })

  async function createTempDir() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'read-tool-'))
    tempDirs.push(dir)
    return dir
  }

  test('reads a file via relative path and resolves cwd', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'note.txt'), 'hello from read tool')
    const tool = createReadTool()

    expect(tool.execute('call_1', { path: 'note.txt', cwd: dir })).resolves.toMatchObject({
      content: 'hello from read tool',
      details: {
        path: path.join(dir, 'note.txt'),
        bytes: 20,
        truncated: false,
        output: 'hello from read tool',
      },
    })
  })

  test('lists directory entries when the path is a directory', async () => {
    const dir = await createTempDir()
    await writeFile(path.join(dir, 'alpha.ts'), 'a')
    await writeFile(path.join(dir, 'beta.md'), 'b')
    const tool = createReadTool()

    const result = (await tool.execute('call_1', { path: dir })) as {
      content: string
      isError?: boolean
    }
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain(`Directory ${dir}`)
    expect(result.content).toContain('alpha.ts')
    expect(result.content).toContain('beta.md')
  })

  test('bounds directory listing at the producer and reports an inexact large count honestly', async () => {
    const entries = Array.from(
      { length: MAX_DIR_ENTRIES + 1 },
      (_, i) => `f${String(i).padStart(4, '0')}`,
    )
    let command = ''
    let options: Parameters<ExecutionEnvironment['exec']>[1]
    const env = {
      async exec(nextCommand: string, nextOptions?: Parameters<ExecutionEnvironment['exec']>[1]) {
        command = nextCommand
        options = nextOptions
        return { stdout: entries.join('\n'), stderr: '', exitCode: 0 }
      },
    } as ExecutionEnvironment

    const listing = await tryListDirectory(env, '/huge')

    expect(command).toContain(`| head -n ${MAX_DIR_ENTRIES + 1}`)
    expect(options).toMatchObject({ uncapped: true })
    expect(listing).toContain(
      `more than ${MAX_DIR_ENTRIES} entries (showing first ${MAX_DIR_ENTRIES})`,
    )
    expect(listing).toContain('f0000')
    expect(listing).toContain(`f${String(MAX_DIR_ENTRIES - 1).padStart(4, '0')}`)
    expect(listing).not.toContain(`f${String(MAX_DIR_ENTRIES).padStart(4, '0')}`)
    expect(listing).toContain('[…more entries omitted]')
  })

  test('returns a clean error for missing files', async () => {
    const dir = await createTempDir()
    const tool = createReadTool()

    expect(tool.execute('call_1', { path: 'missing.txt', cwd: dir })).resolves.toMatchObject({
      isError: true,
      content: `File not found: ${path.join(dir, 'missing.txt')}`,
      details: {
        path: path.join(dir, 'missing.txt'),
        bytes: 0,
        truncated: false,
        // Error text is mirrored into details.output so consumers that render `details` still show the reason.
        output: `File not found: ${path.join(dir, 'missing.txt')}`,
      },
    })
  })

  test('truncates large file output and preserves metadata', async () => {
    const dir = await createTempDir()
    const largeContent = 'a'.repeat(70_000)
    const filePath = path.join(dir, 'large.txt')
    await writeFile(filePath, largeContent)
    const tool = createReadTool()

    const result = await tool.execute('call_1', { path: filePath })

    expect(result.isError).toBeUndefined()
    expect(result.details).toMatchObject({
      path: filePath,
      bytes: 70_000,
      truncated: true,
    })
    expect(result.content).toContain('truncated at')
    expect(result.content).toContain('byte_offset=')
    expect(result.content.length).toBeLessThan(70_000)
  })
})
